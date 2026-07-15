import { watch, type FSWatcher } from "fs";
import {
  resolveJsonlPath,
  readSessionMessages,
  getSessionModifiedAt,
  parseLiveEvents,
} from "@/lib/transcript-reader";
import { getWorkspace } from "@/lib/workspace";
import { sessionIdParam } from "@/lib/validation";
import { isActive, onProcessExit, getLiveEvents, onLiveUpdate } from "@/lib/process-registry";
import { badRequest, notFound } from "@/lib/errors";
import { vlog } from "@/lib/verbose";
import {
  SSE_DEBOUNCE_MS,
  SSE_KEEPALIVE_MS,
  FILE_POLL_MS,
  PROCESS_EXIT_SETTLE_MS,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawId = url.searchParams.get("id");

  const result = sessionIdParam.safeParse(rawId);
  if (!result.success) {
    vlog("watch", "invalid session id", rawId);
    return badRequest("invalid or missing session id");
  }
  const sessionId = result.data;

  const workspace = url.searchParams.get("workspace") || getWorkspace();
  let jsonlPath = await resolveJsonlPath(workspace, sessionId);
  const active = isActive(sessionId);

  vlog("watch", "SSE connect", { sessionId, workspace, jsonlPath: jsonlPath ?? "null", isActive: active });

  if (!jsonlPath && !active) {
    vlog("watch", "session not found — no jsonl and not active", sessionId);
    return notFound("session not found");
  }

  let watcher: FSWatcher | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let filePollTimer: ReturnType<typeof setInterval> | null = null;
  let unsubExit: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let lastSentModified = 0;
  let cancelled = false;

  function startFileWatcher(
    path: string,
    controller: ReadableStreamDefaultController,
    pushUpdate: () => Promise<void>,
  ) {
    try {
      vlog("watch", "starting file watcher", path);
      watcher = watch(path, () => {
        if (cancelled) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void pushUpdate(), SSE_DEBOUNCE_MS);
      });
      watcher.on("error", (err) => {
        vlog("watch", "file watcher error", sessionId, String(err));
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    } catch (err) {
      vlog("watch", "file watcher setup failed", sessionId, String(err));
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const pushFileUpdate = async () => {
        if (cancelled || !jsonlPath) return;
        try {
          const modifiedAt = await getSessionModifiedAt(workspace, sessionId);
          if (modifiedAt <= lastSentModified) {
            vlog("watch", "skipping update — not modified", { sessionId, modifiedAt, lastSentModified });
            return;
          }

          const { messages, toolCalls, thoughts } = await readSessionMessages(workspace, sessionId);
          lastSentModified = modifiedAt;
          vlog("watch", "pushing file update", { sessionId, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length, modifiedAt });
          controller.enqueue(sseMessage("update", { messages, toolCalls, thoughts, modifiedAt, isActive: isActive(sessionId) }));
        } catch (err) {
          vlog("watch", "pushFileUpdate error", sessionId, String(err));
        }
      };

      if (jsonlPath) {
        const { messages, toolCalls, thoughts, modifiedAt: initialModified } = await readSessionMessages(workspace, sessionId);
        lastSentModified = initialModified;
        vlog("watch", "sending connected (file)", { sessionId, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length, modifiedAt: initialModified, isActive: isActive(sessionId) });
        controller.enqueue(sseMessage("connected", { messages, toolCalls, thoughts, modifiedAt: initialModified, isActive: isActive(sessionId) }));
        startFileWatcher(jsonlPath, controller, pushFileUpdate);
      } else {
        const events = getLiveEvents(sessionId);
        const { messages, toolCalls, thoughts } = parseLiveEvents(events, sessionId);
        vlog("watch", "sending connected (live)", { sessionId, liveEvents: events.length, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length });
        controller.enqueue(sseMessage("connected", { messages, toolCalls, thoughts, modifiedAt: Date.now(), isActive: true }));

        let liveDebounce: ReturnType<typeof setTimeout> | null = null;
        unsubLive = onLiveUpdate(sessionId, () => {
          if (cancelled) return;
          if (liveDebounce) clearTimeout(liveDebounce);
          liveDebounce = setTimeout(() => {
            if (cancelled) return;
            const latest = getLiveEvents(sessionId);
            const parsed = parseLiveEvents(latest, sessionId);
            vlog("watch", "pushing live update", { sessionId, messages: parsed.messages.length, toolCalls: parsed.toolCalls.length, thoughts: parsed.thoughts.length });
            controller.enqueue(sseMessage("update", { messages: parsed.messages, toolCalls: parsed.toolCalls, thoughts: parsed.thoughts, modifiedAt: Date.now(), isActive: isActive(sessionId) }));
          }, SSE_DEBOUNCE_MS);
        });

        filePollTimer = setInterval(async () => {
          if (cancelled) return;
          const path = await resolveJsonlPath(workspace, sessionId);
          if (!path) return;
          vlog("watch", "jsonl file appeared during poll, switching to file watcher", { sessionId, path });
          jsonlPath = path;
          if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
          if (unsubLive) { unsubLive(); unsubLive = null; }
          startFileWatcher(path, controller, pushFileUpdate);
          void pushFileUpdate();
        }, FILE_POLL_MS);
      }

      unsubExit = onProcessExit(sessionId, async () => {
        if (cancelled) return;
        vlog("watch", "process exit detected", sessionId);
        await new Promise((r) => setTimeout(r, PROCESS_EXIT_SETTLE_MS));
        try {
          const { messages, toolCalls, thoughts, modifiedAt } = await readSessionMessages(workspace, sessionId);
          if (modifiedAt > lastSentModified) lastSentModified = modifiedAt;
          vlog("watch", "sending final update after exit", { sessionId, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length, modifiedAt });
          controller.enqueue(sseMessage("update", { messages, toolCalls, thoughts, modifiedAt, isActive: false }));
        } catch (err) {
          vlog("watch", "exit read failed, falling back to live events", sessionId, String(err));
          const events = getLiveEvents(sessionId);
          const parsed = parseLiveEvents(events, sessionId);
          try {
            controller.enqueue(sseMessage("update", { messages: parsed.messages, toolCalls: parsed.toolCalls, thoughts: parsed.thoughts, modifiedAt: Date.now(), isActive: false }));
          } catch { /* stream closed */ }
        }
      });

      keepaliveTimer = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(sseMessage("ping", { ts: Date.now() }));
        } catch {
          cleanup();
        }
      }, SSE_KEEPALIVE_MS);
    },
    cancel() {
      vlog("watch", "SSE stream cancelled", sessionId);
      cleanup();
    },
  });

  function cleanup() {
    cancelled = true;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
    if (unsubExit) { unsubExit(); unsubExit = null; }
    if (unsubLive) { unsubLive(); unsubLive = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    if (watcher) { watcher.close(); watcher = null; }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
