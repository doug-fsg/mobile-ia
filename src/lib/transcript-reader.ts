import { readdir, stat, readFile, access } from "fs/promises";
import { createReadStream, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { join, resolve, sep, relative, isAbsolute } from "path";
import { homedir } from "os";
import type { StoredSession, ChatMessage, ToolCallInfo, ThoughtInfo, ProjectInfo } from "@/lib/types";
import { parseJsonlEntriesToTimeline, parseLiveEventsToTimeline } from "@/lib/parse-timeline";
import { cleanSessionTitle } from "@/lib/format";
import { vlog } from "@/lib/verbose";

const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");

/**
 * Cursor stores project folders under ~/.cursor/projects using a slug of the
 * absolute workspace path: separators and spaces become '-', ':' is dropped.
 * Casing varies (C-Users-... vs c-cursor-...), so callers should try both.
 * WSL remote workspaces use keys like wsl-Ubuntu-20-04-home-user-app → \\wsl$\Ubuntu-20.04\...
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

/** Cursor WSL key from a Windows UNC path, e.g. \\wsl$\Ubuntu-20.04\home\a → wsl-Ubuntu-20-04-home-a */
function uncWslToCursorKey(workspace: string): string | null {
  const normalized = workspace.replace(/\//g, "\\");
  const m = normalized.match(/^\\\\wsl\$\\([^\\]+)(?:\\(.*))?$/i);
  if (!m) return null;
  const distro = m[1].replace(/\./g, "-");
  const rest = (m[2] || "").replace(/\\+/g, "-").replace(/\s+/g, "-");
  return (rest ? `wsl-${distro}-${rest}` : `wsl-${distro}`);
}

function workspaceKeyCandidates(workspace: string): string[] {
  const preserved = slugifyWorkspace(workspace, false);
  const lower = preserved.toLowerCase();
  const keys = new Set<string>([lower, preserved]);

  for (const candidate of [workspace, resolve(workspace)]) {
    const cursorWsl = uncWslToCursorKey(candidate);
    if (cursorWsl) {
      keys.add(cursorWsl);
      keys.add(cursorWsl.toLowerCase());
    }
  }
  return [...keys];
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function distroNameCandidates(parts: string[]): string[] {
  const joined = parts.join("-");
  const out = new Set<string>([joined]);
  // Cursor slugifies Ubuntu-20.04 → Ubuntu-20-04; restore dots between digit groups.
  out.add(joined.replace(/(\d+)-(\d+)/g, "$1.$2"));
  return [...out];
}

/** Greedy reconstruction of a path from slug parts against the real filesystem. */
function walkPathParts(start: string, parts: string[]): string | null {
  let path = start;
  let i = 0;

  while (i < parts.length) {
    let matched = false;

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

/** wsl-Ubuntu-20-04-home-user-app → \\wsl$\Ubuntu-20.04\home\user\app */
function resolveWslProjectKey(partsAfterWsl: string[]): string | null {
  for (let j = 0; j < partsAfterWsl.length; j++) {
    for (const distro of distroNameCandidates(partsAfterWsl.slice(0, j + 1))) {
      const root = `\\\\wsl$\\${distro}`;
      if (!isDir(root)) continue;
      const remaining = partsAfterWsl.slice(j + 1);
      if (remaining.length === 0) return root;
      const full = walkPathParts(root, remaining);
      if (full) return full;
    }
  }
  return null;
}

function projectKeyToWorkspace(key: string): string | null {
  const parts = key.split("-");
  if (parts.length === 0 || !parts[0]) return null;

  if (parts[0].toLowerCase() === "wsl" && parts.length >= 2) {
    const wslPath = resolveWslProjectKey(parts.slice(1));
    if (wslPath) return wslPath;
  }

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

  return walkPathParts(path, parts.slice(i));
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
      const name = workspace.split(/[/\\]/).pop() || workspace;
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
  // Stream line-by-line so listing dozens of sessions does not load each jsonl fully.
  const stream = createReadStream(jsonlPath, { encoding: "utf-8", highWaterMark: 64 * 1024 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.role !== "user") continue;
        const msg = entry.message as Record<string, unknown> | undefined;
        const content = msg?.content as Array<Record<string, unknown>> | undefined;
        const text: string = (content?.[0]?.text as string) || "";
        return cleanSessionTitle(text.replace(/<[^>]+>/g, ""), 120);
      } catch {
        continue;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return "";
}

const previewCache = new Map<string, { mtime: number; preview: string }>();

async function extractFirstUserMessageCached(jsonlPath: string, mtimeMs: number): Promise<string> {
  const hit = previewCache.get(jsonlPath);
  if (hit && hit.mtime === mtimeMs) return hit.preview;
  const preview = await extractFirstUserMessage(jsonlPath);
  previewCache.set(jsonlPath, { mtime: mtimeMs, preview });
  // Bound cache size (sessions come and go).
  if (previewCache.size > 400) {
    const first = previewCache.keys().next().value;
    if (first) previewCache.delete(first);
  }
  return preview;
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
      const preview = await extractFirstUserMessageCached(jsonl, s.mtimeMs);

      if (!preview) continue;

      sessions.push({
        id: sessionId,
        title: cleanSessionTitle(preview, 60),
        workspace,
        preview: cleanSessionTitle(preview, 100),
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

export async function readSessionMessagesFromPath(
  jsonlPath: string,
  sessionId: string,
): Promise<SessionHistoryResult> {
  const t0 = Date.now();
  let modifiedAt = 0;
  try {
    modifiedAt = (await stat(jsonlPath)).mtimeMs;
  } catch (err) {
    vlog("reader", "readSessionMessagesFromPath: stat failed", { jsonlPath, error: String(err) });
    return { messages: [], toolCalls: [], thoughts: [], modifiedAt: 0 };
  }

  const entries = await parseJsonlEntries(jsonlPath);
  vlog("reader", "readSessionMessagesFromPath: parsed jsonl", {
    sessionId,
    entries: entries.length,
    jsonlPath,
    bytesHint: entries.length,
  });

  const { messages, toolCalls, thoughts } = parseJsonlEntriesToTimeline(
    entries,
    sessionId,
    modifiedAt - 60_000,
  );

  vlog("reader", "readSessionMessagesFromPath: done", {
    sessionId,
    messages: messages.length,
    toolCalls: toolCalls.length,
    thoughts: thoughts.length,
    modifiedAt,
    ms: Date.now() - t0,
  });

  return { messages, toolCalls, thoughts, modifiedAt };
}

export function parseLiveEvents(
  events: Record<string, unknown>[],
  sessionId: string,
): { messages: ChatMessage[]; toolCalls: ToolCallInfo[]; thoughts: ThoughtInfo[] } {
  return parseLiveEventsToTimeline(events, sessionId);
}

export async function readSessionMessages(workspace: string, sessionId: string): Promise<SessionHistoryResult> {
  const jsonlPath = await resolveJsonlPath(workspace, sessionId);
  if (!jsonlPath) {
    vlog("reader", "readSessionMessages: no jsonl path", { workspace, sessionId });
    return { messages: [], toolCalls: [], thoughts: [], modifiedAt: 0 };
  }
  return readSessionMessagesFromPath(jsonlPath, sessionId);
}
