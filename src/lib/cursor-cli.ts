import { spawn, execFileSync, type ChildProcess } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentMode } from "@/lib/types";
import { getConfig } from "@/lib/session-store";

export interface AgentInvocation {
  /** Executable to run (node.exe, agent, etc.) */
  command: string;
  /** Args that must come before CLI flags (e.g. path to index.js) */
  prefixArgs: string[];
}

let cachedInvocation: AgentInvocation | null = null;

const VERSION_DIR_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

function findWindowsAgentInvocation(): AgentInvocation | null {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;

  const versionsRoot = join(local, "cursor-agent", "versions");
  if (!existsSync(versionsRoot)) return null;

  const versions = readdirSync(versionsRoot)
    .filter((name) => VERSION_DIR_RE.test(name))
    .sort()
    .reverse();

  for (const version of versions) {
    const dir = join(versionsRoot, version);
    const nodePath = join(dir, "node.exe");
    const indexPath = join(dir, "index.js");
    if (existsSync(nodePath) && existsSync(indexPath)) {
      return { command: nodePath, prefixArgs: [indexPath] };
    }
  }

  return null;
}

function tryInvocation(inv: AgentInvocation): boolean {
  try {
    execFileSync(inv.command, [...inv.prefixArgs, "--version"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve how to run the Cursor agent CLI.
 * On Windows, prefer node.exe + index.js so paths with spaces are not
 * mangled by cmd.exe (shell:true + .cmd wrappers).
 */
export function resolveAgentInvocation(): AgentInvocation {
  if (cachedInvocation) return cachedInvocation;

  if (process.platform === "win32") {
    const win = findWindowsAgentInvocation();
    if (win && tryInvocation(win)) {
      cachedInvocation = win;
      return win;
    }
  }

  const pathCandidates: AgentInvocation[] = [{ command: "agent", prefixArgs: [] }];
  if (process.platform !== "win32") {
    pathCandidates.push({ command: join(homedir(), ".local", "bin", "agent"), prefixArgs: [] });
  }

  for (const inv of pathCandidates) {
    if (inv.command !== "agent" && !existsSync(inv.command)) continue;
    if (tryInvocation(inv)) {
      cachedInvocation = inv;
      return inv;
    }
  }

  throw new Error(
    "Could not find the 'agent' CLI. Make sure Cursor is installed and the CLI is on your PATH. On Windows, run: irm 'https://cursor.com/install?win32=true' | iex",
  );
}

/** @deprecated Use resolveAgentInvocation — kept for call sites that only need a display name */
export function resolveAgentCommand(): string {
  const inv = resolveAgentInvocation();
  return inv.prefixArgs[0] ?? inv.command;
}

export interface AgentOptions {
  prompt: string;
  sessionId?: string;
  workspace?: string;
  model?: string;
  mode?: AgentMode;
  /** Create/use an isolated git worktree (only for new sessions). */
  worktree?: boolean;
}

async function shouldTrust(): Promise<boolean> {
  if (process.env.CURSOR_TRUST === "0") return false;
  if (process.env.CURSOR_TRUST === "1") return true;
  const val = await getConfig("trust");
  return val !== "0";
}

export async function spawnAgent(options: AgentOptions): Promise<ChildProcess> {
  const inv = resolveAgentInvocation();
  const args = [
    ...inv.prefixArgs,
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ];

  if (await shouldTrust()) {
    args.push("--trust");
  }
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }
  if (options.workspace) {
    args.push("--workspace", options.workspace);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.mode && options.mode !== "agent") {
    args.push("--mode", options.mode);
  }
  // Worktrees only apply to new chats — resume continues the existing checkout.
  if (options.worktree && !options.sessionId) {
    args.push("--worktree");
  }

  // Never use shell:true — it re-parses args and breaks paths with spaces.
  return spawn(inv.command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });
}
