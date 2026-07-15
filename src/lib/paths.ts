import { resolve, relative, isAbsolute, sep } from "path";
import { existsSync, statSync } from "fs";
import { getWorkspace } from "@/lib/workspace";

/** True if `child` is `parent` or a path under it (after resolve). */
export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve a user-supplied path that must stay under `root`.
 * Rejects absolute paths and any `..` escape.
 */
export function resolveInside(root: string, userPath: string): string | null {
  if (!userPath || userPath.includes("\0")) return null;
  const abs = resolve(root, userPath);
  if (!isPathInside(root, abs)) return null;
  return abs;
}

/**
 * Normalize a workspace/cwd from the client.
 * Must exist as a directory. Defaults to CURSOR_WORKSPACE / cwd.
 */
export function resolveExistingDir(requested?: string | null): string | null {
  const candidate = requested?.trim() ? resolve(requested.trim()) : getWorkspace();
  try {
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Safe image extension from a client filename (no path segments). */
export function safeImageExt(filename: string): string | null {
  const base = filename.replace(/\\/g, "/").split("/").pop() || "";
  const m = base.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

export function pathSep(): string {
  return sep;
}
