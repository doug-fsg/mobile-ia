import type { ChildProcess } from "child_process";
import { LIVE_EVENT_TTL_MS } from "@/lib/constants";

type ProcessExitHook = (sessionId: string, workspace: string) => void;

interface RunningProcess {
  child: ChildProcess;
  sessionId: string | null;
  mapKey: string;
  workspace: string;
  startedAt: number;
  cleaned: boolean;
}

let globalExitHook: ProcessExitHook | null = null;

export function setProcessExitHook(hook: ProcessExitHook): void {
  globalExitHook = hook;
}

const processes = new Map<string, RunningProcess>();
const exitListeners = new Map<string, Set<() => void>>();
const liveEvents = new Map<string, Record<string, unknown>[]>();
const liveListeners = new Map<string, Set<() => void>>();

const MAX_LIVE_EVENTS = 2_000;

export function pushLiveEvent(sessionId: string, event: Record<string, unknown>): void {
  let events = liveEvents.get(sessionId);
  if (!events) {
    events = [];
    liveEvents.set(sessionId, events);
  }
  events.push(event);
  if (events.length > MAX_LIVE_EVENTS) {
    events.splice(0, events.length - MAX_LIVE_EVENTS);
  }

  const listeners = liveListeners.get(sessionId);
  if (listeners) {
    for (const cb of listeners) cb();
  }
}

export function getLiveEvents(sessionId: string): Record<string, unknown>[] {
  return liveEvents.get(sessionId) ?? [];
}

export function onLiveUpdate(sessionId: string, cb: () => void): () => void {
  let set = liveListeners.get(sessionId);
  if (!set) {
    set = new Set();
    liveListeners.set(sessionId, set);
  }
  const captured = set;
  captured.add(cb);
  return () => {
    captured.delete(cb);
  };
}

export function registerProcess(
  requestId: string,
  child: ChildProcess,
  workspace: string,
): void {
  const entry: RunningProcess = {
    child,
    sessionId: null,
    mapKey: requestId,
    workspace,
    startedAt: Date.now(),
    cleaned: false,
  };
  processes.set(requestId, entry);

  const onExit = () => {
    if (entry.cleaned) return;
    entry.cleaned = true;

    const sid = entry.sessionId ?? entry.mapKey;
    processes.delete(entry.mapKey);
    const listeners = exitListeners.get(entry.mapKey);
    if (listeners) {
      exitListeners.delete(entry.mapKey);
      for (const cb of listeners) cb();
    }
    if (globalExitHook && entry.sessionId) {
      try {
        globalExitHook(sid, entry.workspace);
      } catch {
        // don't let push errors break process cleanup
      }
    }
    setTimeout(() => {
      liveEvents.delete(entry.mapKey);
      liveListeners.delete(entry.mapKey);
    }, LIVE_EVENT_TTL_MS);
  };
  child.once("close", onExit);
  child.once("error", onExit);
}

export function onProcessExit(sessionId: string, cb: () => void): () => void {
  if (!processes.has(sessionId)) {
    cb();
    return () => {};
  }
  let set = exitListeners.get(sessionId);
  if (!set) {
    set = new Set();
    exitListeners.set(sessionId, set);
  }
  const captured = set;
  captured.add(cb);
  return () => {
    captured.delete(cb);
  };
}

export function promoteToSessionId(requestId: string, sessionId: string): void {
  const entry = processes.get(requestId) ?? processes.get(sessionId);
  if (!entry) return;
  entry.sessionId = sessionId;
  if (entry.mapKey !== sessionId) {
    processes.delete(entry.mapKey);
    processes.set(sessionId, entry);
    entry.mapKey = sessionId;

    // Move any pre-promote live events keyed by requestId
    const pending = liveEvents.get(requestId);
    if (pending?.length) {
      const dest = liveEvents.get(sessionId) ?? [];
      liveEvents.set(sessionId, [...pending, ...dest].slice(-MAX_LIVE_EVENTS));
      liveEvents.delete(requestId);
    }
    const pendListeners = liveListeners.get(requestId);
    if (pendListeners) {
      const dest = liveListeners.get(sessionId) ?? new Set<() => void>();
      for (const cb of pendListeners) dest.add(cb);
      liveListeners.set(sessionId, dest);
      liveListeners.delete(requestId);
    }
  }
}

export function getActiveSessionIds(): string[] {
  const seen = new Set<string>();
  for (const [key, entry] of processes) {
    seen.add(entry.sessionId ?? key);
  }
  return Array.from(seen);
}

export function isActive(sessionId: string): boolean {
  return processes.has(sessionId);
}

export function killProcess(sessionId: string): boolean {
  const entry = processes.get(sessionId);
  if (!entry) return false;
  entry.child.kill("SIGTERM");
  return true;
}

export function killAllProcesses(): void {
  for (const entry of processes.values()) {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
}
