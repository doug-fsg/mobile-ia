import { readdir, stat, readFile, access } from "fs/promises";
import { join, resolve, sep, relative, isAbsolute } from "path";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import type { StoredSession, ChatMessage, ToolCallInfo, ThoughtInfo, ProjectInfo } from "@/lib/types";
import { parseJsonlEntriesToTimeline, parseLiveEventsToTimeline } from "@/lib/parse-timeline";
import { vlog } from "@/lib/verbose";

const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");

/**
 * Cursor stores project folders under ~/.cursor/projects using a slug of the
 * absolute workspace path: separators and spaces become '-', ':' is dropped.
 * Casing varies (C-Users-... vs c-cursor-...), so callers should try both.
 */
export function workspaceToProjectKey(workspace: string): string {
  return slugifyWorkspace(workspace);
}

function slugifyWorkspace(workspace: string, lowercase = true): string {
  const abs = resolve(workspace);
  const slug = abs
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]+/g, "-")
    .replace(/:/g, "")
    .replace(/\s+/g, "-");
  return lowercase ? slug.toLowerCase() : slug;
}

function workspaceKeyCandidates(workspace: string): string[] {
  const preserved = slugifyWorkspace(workspace, false);
  const lower = preserved.toLowerCase();
  return [...new Set([lower, preserved])];
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function projectKeyToWorkspace(key: string): string | null {
  const parts = key.split("-");
  if (parts.length === 0 || !parts[0]) return null;

  let path: string;
  let i: number;

  // Windows drive keys: C-Users-Dougl / c-cursor-remoto-...
  if (/^[A-Za-z]$/.test(parts[0])) {
    path = `${parts[0].toUpperCase()}:`;
    i = 1;
  } else {
    path = sep + parts[0];
    i = 1;
  }

  while (i < parts.length) {
    let matched = false;

    // Prefer shorter directory names (same as Cursor's greedy join).
    for (let j = i; j < parts.length; j++) {
      const slice = parts.slice(i, j + 1);
      const names = [...new Set([slice.join("-"), slice.join(" ")])];

      for (const name of names) {
        const candidate = path.endsWith(":") ? `${path}${sep}${name}` : join(path, name);
        if (isDir(candidate)) {
          path = candidate;
          i = j + 1;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) return null;
  }

  return existsSync(path) ? path : null;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  try {
    const entries = await readdir(CURSOR_PROJECTS_DIR);
    for (const entry of entries) {
      // Drive-letter projects (C-Users-..., c-cursor-...) and numeric/cloud ids skipped
      if (!/^[A-Za-z]/.test(entry)) continue;
      // Skip pure numeric / uuid-like dirs
      if (/^\d+$/.test(entry)) continue;

      const transcriptsDir = join(CURSOR_PROJECTS_DIR, entry, "agent-transcripts");
      try {
        await access(transcriptsDir);
      } catch {
        continue;
      }
      const workspace = projectKeyToWorkspace(entry);
      if (!workspace) continue;
      const name = workspace.split(sep).pop() || workspace;
      projects.push({ name, path: workspace, key: entry });
    }
  } catch {
    // projects dir doesn't exist or can't be read
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function findTranscriptsDir(workspace: string): Promise<string | null> {
  for (const key of workspaceKeyCandidates(workspace)) {
    const dir = join(CURSOR_PROJECTS_DIR, key, "agent-transcripts");
    try {
      await access(dir);
      vlog("reader", "transcripts dir found", dir);
      return dir;
    } catch {
      // try next candidate
    }
  }
  vlog("reader", "transcripts dir not found", {
    workspace,
    tried: workspaceKeyCandidates(workspace),
  });
  return null;
}

async function parseJsonlEntries(jsonlPath: string): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(jsonlPath, "utf-8");
    const entries: Record<string, unknown>[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function extractFirstUserMessage(jsonlPath: string): Promise<string> {
  for (const entry of await parseJsonlEntries(jsonlPath)) {
    if (entry.role === "user") {
      const msg = entry.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      const text: string = (content?.[0]?.text as string) || "";
      return text
        .replace(/<[^>]+>/g, "")
        .trim()
        .slice(0, 120);
    }
  }
  return "";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findJsonlFile(entryPath: string, entryName: string): Promise<string | null> {
  const s = await stat(entryPath);

  if (s.isFile() && entryName.endsWith(".jsonl")) {
    return entryPath;
  }

  if (s.isDirectory()) {
    const expectedName = entryName.endsWith(".jsonl") ? entryName : `${entryName}.jsonl`;
    const inner = join(entryPath, expectedName);
    if (await pathExists(inner)) return inner;
    // Do not fall back to an arbitrary .jsonl — that leaks/mixes other sessions.
  }

  return null;
}

export async function readCursorSessions(workspace: string): Promise<StoredSession[]> {
  const dir = await findTranscriptsDir(workspace);
  if (!dir) return [];

  const sessions: StoredSession[] = [];

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const jsonl = await findJsonlFile(entryPath, entry.replace(".jsonl", ""));
      if (!jsonl) continue;

      const s = await stat(jsonl);
      const sessionId = entry.replace(".jsonl", "");
      const preview = await extractFirstUserMessage(jsonl);

      if (!preview) continue;

      sessions.push({
        id: sessionId,
        title: preview.slice(0, 60),
        workspace,
        preview,
        createdAt: s.birthtimeMs,
        updatedAt: s.mtimeMs,
      });
    }
  } catch {
    // directory read error
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface SessionHistoryResult {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  thoughts: ThoughtInfo[];
  modifiedAt: number;
}

export async function resolveJsonlPath(workspace: string, sessionId: string): Promise<string | null> {
  const dir = await findTranscriptsDir(workspace);
  if (!dir) {
    vlog("reader", "resolveJsonlPath: no transcripts dir", { workspace, sessionId });
    return null;
  }

  const resolvedDir = resolve(dir);
  const entryPath = resolve(dir, sessionId);
  if (!isPathInside(resolvedDir, entryPath)) {
    vlog("reader", "resolveJsonlPath: path traversal blocked", { entryPath, resolvedDir });
    return null;
  }

  const flatPath = join(dir, sessionId + ".jsonl");

  if (await pathExists(entryPath)) {
    const s = await stat(entryPath);
    if (s.isDirectory()) {
      const result = await findJsonlFile(entryPath, sessionId);
      vlog("reader", "resolveJsonlPath: directory entry", { sessionId, found: result ?? "null" });
      return result;
    }
  }
  if (await pathExists(flatPath)) {
    vlog("reader", "resolveJsonlPath: flat file", { sessionId, path: flatPath });
    return flatPath;
  }
  vlog("reader", "resolveJsonlPath: not found", { sessionId, triedDir: entryPath, triedFlat: flatPath });
  return null;
}

export async function getSessionModifiedAt(workspace: string, sessionId: string): Promise<number> {
  const jsonlPath = await resolveJsonlPath(workspace, sessionId);
  if (!jsonlPath) return 0;
  try {
    return (await stat(jsonlPath)).mtimeMs;
  } catch {
    return 0;
  }
}

export function parseLiveEvents(
  events: Record<string, unknown>[],
  sessionId: string,
): { messages: ChatMessage[]; toolCalls: ToolCallInfo[]; thoughts: ThoughtInfo[] } {
  return parseLiveEventsToTimeline(events, sessionId);
}

export async function readSessionMessages(workspace: string, sessionId: string): Promise<SessionHistoryResult> {
  const t0 = Date.now();
  const jsonlPath = await resolveJsonlPath(workspace, sessionId);
  if (!jsonlPath) {
    vlog("reader", "readSessionMessages: no jsonl path", { workspace, sessionId });
    return { messages: [], toolCalls: [], thoughts: [], modifiedAt: 0 };
  }

  let modifiedAt = 0;
  try {
    modifiedAt = (await stat(jsonlPath)).mtimeMs;
  } catch (err) {
    vlog("reader", "readSessionMessages: stat failed", { jsonlPath, error: String(err) });
    return { messages: [], toolCalls: [], thoughts: [], modifiedAt: 0 };
  }

  const entries = await parseJsonlEntries(jsonlPath);
  vlog("reader", "readSessionMessages: parsed jsonl", { sessionId, entries: entries.length, jsonlPath });

  const { messages, toolCalls, thoughts } = parseJsonlEntriesToTimeline(
    entries,
    sessionId,
    modifiedAt - 60_000,
  );

  vlog("reader", "readSessionMessages: done", {
    sessionId, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length,
    modifiedAt, ms: Date.now() - t0,
  });

  return { messages, toolCalls, thoughts, modifiedAt };
}