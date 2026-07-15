import initSqlJs from "sql.js";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import type { StoredSession } from "@/lib/types";
import { cleanSessionTitle } from "@/lib/format";

const DATA_DIR = join(homedir(), ".cursor-local-remote");
const DB_PATH = join(DATA_DIR, "sessions.db");

type Database = initSqlJs.Database;

let db: Database | null = null;
let sqlReady: Promise<initSqlJs.SqlJsStatic> | null = null;

function getSql() {
  if (!sqlReady) sqlReady = initSqlJs();
  return sqlReady;
}

function save() {
  if (!db) return;
  writeFileSync(DB_PATH, Buffer.from(db.export()));
}

export async function getDb(): Promise<Database> {
  if (db) return db;

  const { Database: SqlDatabase } = await getSql();
  mkdirSync(DATA_DIR, { recursive: true });

  if (existsSync(DB_PATH)) {
    const buf = readFileSync(DB_PATH);
    db = new SqlDatabase(buf);
  } else {
    db = new SqlDatabase();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  try {
    db.run("ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  } catch {
    // column already exists
  }
  try {
    db.run("ALTER TABLE sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
  } catch {
    // column already exists
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  save();
  return db;
}

type SqlValue = initSqlJs.SqlValue;

function queryOne(conn: Database, sql: string, params: SqlValue[]): Record<string, SqlValue> | undefined {
  const stmt = conn.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject() as Record<string, SqlValue>;
    return undefined;
  } finally {
    stmt.free();
  }
}

function queryAll(conn: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = conn.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, SqlValue>);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function rowToSession(row: Record<string, SqlValue>): StoredSession {
  return {
    id: row.id as string,
    title: row.title as string,
    workspace: row.workspace as string,
    preview: row.preview as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export async function getSessionTitle(sessionId: string): Promise<string | null> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT title FROM sessions WHERE id = ?", [sessionId]);
  return row ? (row.title as string) : null;
}

export async function upsertSession(
  sessionId: string,
  workspace: string,
  firstMessage: string,
): Promise<StoredSession> {
  const conn = await getDb();
  const now = Date.now();
  const existing = queryOne(conn, "SELECT * FROM sessions WHERE id = ?", [sessionId]);

  if (existing) {
    const preview = firstMessage
      ? cleanSessionTitle(firstMessage, 120)
      : cleanSessionTitle((existing.preview as string) || "", 120);
    conn.run("UPDATE sessions SET updated_at = ?, preview = ? WHERE id = ?", [now, preview, sessionId]);
    save();
    return rowToSession({ ...existing, updated_at: now, preview });
  }

  const title = cleanSessionTitle(firstMessage, 60) || "Nova sessão";
  const preview = cleanSessionTitle(firstMessage, 120);
  conn.run(
    "INSERT INTO sessions (id, title, workspace, preview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionId, title, workspace, preview, now, now],
  );
  save();
  return { id: sessionId, title, workspace, preview, createdAt: now, updatedAt: now };
}

export async function listSessions(workspace?: string, includeArchived = false): Promise<StoredSession[]> {
  const conn = await getDb();
  const archivedFilter = includeArchived ? " archived = 1" : " archived = 0";
  const rows = workspace
    ? queryAll(
        conn,
        "SELECT * FROM sessions WHERE workspace = ? AND deleted = 0 AND" + archivedFilter + " ORDER BY updated_at DESC",
        [workspace],
      )
    : queryAll(
        conn,
        "SELECT * FROM sessions WHERE deleted = 0 AND" + archivedFilter + " ORDER BY updated_at DESC",
      );
  return rows.map(rowToSession);
}

export async function archiveSession(sessionId: string, session?: StoredSession): Promise<void> {
  const conn = await getDb();
  const existing = queryOne(conn, "SELECT id FROM sessions WHERE id = ?", [sessionId]);
  if (!existing && session) {
    const now = Date.now();
    conn.run(
      "INSERT INTO sessions (id, title, workspace, preview, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [session.id, session.title, session.workspace, session.preview, session.createdAt || now, session.updatedAt || now],
    );
  } else {
    conn.run("UPDATE sessions SET archived = 1 WHERE id = ?", [sessionId]);
  }
  save();
}

export async function unarchiveSession(sessionId: string): Promise<void> {
  const conn = await getDb();
  conn.run("UPDATE sessions SET archived = 0 WHERE id = ?", [sessionId]);
  save();
}

export async function archiveAllSessions(workspace?: string, extraSessions?: StoredSession[]): Promise<void> {
  const conn = await getDb();
  if (extraSessions) {
    const now = Date.now();
    for (const s of extraSessions) {
      const existing = queryOne(conn, "SELECT id FROM sessions WHERE id = ?", [s.id]);
      if (!existing) {
        conn.run(
          "INSERT INTO sessions (id, title, workspace, preview, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, 0)",
          [s.id, s.title, s.workspace, s.preview, s.createdAt || now, s.updatedAt || now],
        );
      }
    }
  }
  if (workspace) {
    conn.run("UPDATE sessions SET archived = 1 WHERE workspace = ? AND archived = 0", [workspace]);
  } else {
    conn.run("UPDATE sessions SET archived = 1 WHERE archived = 0");
  }
  save();
}

export async function getArchivedSessionIds(): Promise<Set<string>> {
  const conn = await getDb();
  const rows = queryAll(conn, "SELECT id FROM sessions WHERE archived = 1 AND deleted = 0");
  return new Set(rows.map((r) => r.id as string));
}

/**
 * Soft-delete: keep a tombstone so Cursor-sourced sessions stay hidden
 * after merge (hard DELETE alone lets them reappear from transcripts).
 */
export async function deleteSession(sessionId: string, session?: StoredSession): Promise<void> {
  const conn = await getDb();
  const existing = queryOne(conn, "SELECT id FROM sessions WHERE id = ?", [sessionId]);
  const now = Date.now();

  if (!existing) {
    conn.run(
      "INSERT INTO sessions (id, title, workspace, preview, created_at, updated_at, archived, deleted) VALUES (?, ?, ?, ?, ?, ?, 0, 1)",
      [
        sessionId,
        session?.title || "Deleted",
        session?.workspace || "",
        session?.preview || "",
        session?.createdAt || now,
        now,
      ],
    );
  } else {
    conn.run("UPDATE sessions SET deleted = 1, updated_at = ? WHERE id = ?", [now, sessionId]);
  }
  save();
}

export async function getDeletedSessionIds(): Promise<Set<string>> {
  const conn = await getDb();
  const rows = queryAll(conn, "SELECT id FROM sessions WHERE deleted = 1");
  return new Set(rows.map((r) => r.id as string));
}

export async function getConfig(key: string): Promise<string | undefined> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT value FROM config WHERE key = ?", [key]);
  return row?.value as string | undefined;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const conn = await getDb();
  conn.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, value]);
  save();
}

export async function listWorkspaces(): Promise<string[]> {
  const conn = await getDb();
  const rows = queryAll(conn, "SELECT DISTINCT workspace FROM sessions ORDER BY workspace");
  return rows.map((r) => r.workspace as string);
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const conn = await getDb();
  const rows = queryAll(conn, "SELECT key, value FROM config WHERE key NOT LIKE 'vapid%'");
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key as string] = row.value as string;
  }
  return result;
}
