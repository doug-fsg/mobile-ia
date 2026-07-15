import { readdirSync, existsSync } from "fs";
import { join, relative, sep, extname } from "path";

export type MentionKind = "file" | "folder" | "skill";

export interface MentionItem {
  id: string;
  kind: MentionKind;
  label: string;
  detail?: string;
  /** Value inserted into the chat (e.g. relative path or /skill-name) */
  insert: string;
  /** Absolute path when kind is file/folder/skill */
  path?: string;
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
]);

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".php",
  ".rb",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
]);

function shouldIgnore(name: string): boolean {
  return IGNORE.has(name) || name.startsWith(".");
}

function walk(
  root: string,
  dir: string,
  files: MentionItem[],
  folders: MentionItem[],
  budget: { left: number },
  depth: number,
): void {
  if (budget.left <= 0 || depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (budget.left <= 0) return;
    if (shouldIgnore(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");

    if (entry.isDirectory()) {
      folders.push({
        id: `folder:${rel}`,
        kind: "folder",
        label: rel,
        detail: "Folder",
        insert: `@${rel}`,
        path: full,
      });
      budget.left -= 1;
      walk(root, full, files, folders, budget, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!CODE_EXTS.has(ext) && !entry.name.endsWith(".env.example")) continue;
    files.push({
      id: `file:${rel}`,
      kind: "file",
      label: rel,
      detail: ext.slice(1) || "file",
      insert: `@${rel}`,
      path: full,
    });
    budget.left -= 1;
  }
}

export function searchMentions(
  workspace: string,
  query: string,
  limit = 40,
): MentionItem[] {
  if (!workspace || !existsSync(workspace)) return [];

  const q = query.trim().toLowerCase().replace(/^@/, "");
  const files: MentionItem[] = [];
  const folders: MentionItem[] = [];
  walk(workspace, workspace, files, folders, { left: 2500 }, 0);

  const pool = [...folders, ...files];
  let results = pool;
  if (q) {
    const scored = pool
      .map((item) => {
        const label = item.label.toLowerCase();
        const base = label.split("/").pop() || label;
        let score = 0;
        if (base === q) score = 100;
        else if (base.startsWith(q)) score = 80;
        else if (label.includes(q)) score = 40;
        else if (base.includes(q)) score = 30;
        else return null;
        return { item, score };
      })
      .filter((x): x is { item: MentionItem; score: number } => x !== null)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
    results = scored.map((x) => x.item);
  } else {
    results = pool.slice(0, limit);
  }

  return results.slice(0, limit);
}

export function isPathInsideWorkspace(workspace: string, target: string): boolean {
  try {
    const root = workspace.replace(/[\\/]+$/, "");
    const abs = target;
    const rel = relative(root, abs);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
  } catch {
    return false;
  }
}
