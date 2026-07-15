"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, ToolCallInfo, ThoughtInfo } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { vlog } from "@/lib/verbose";

export interface SessionWatchState {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  thoughts: ThoughtInfo[];
  isWatching: boolean;
  isActive: boolean;
  lastModified: number;
}

interface UseSessionWatchOptions {
  onStreamEnd?: () => void;
  onStreamStart?: () => void;
}

export function useSessionWatch(options: UseSessionWatchOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [thoughts, setThoughts] = useState<ThoughtInfo[]>([]);
  const [isWatching, setIsWatching] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastModifiedRef = useRef<number>(0);
  const onStreamEndRef = useRef(options.onStreamEnd);
  const onStreamStartRef = useRef(options.onStreamStart);

  useEffect(() => { onStreamEndRef.current = options.onStreamEnd; }, [options.onStreamEnd]);
  useEffect(() => { onStreamStartRef.current = options.onStreamStart; }, [options.onStreamStart]);

  const stopWatching = useCallback(() => {
    if (eventSourceRef.current) {
      vlog("watch-client", "stopWatching: closing EventSource");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsWatching(false);
  }, []);

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const incomingIds = new Set(incoming.map((m) => m.id));
      const incomingUserTexts = new Set(
        incoming.filter((m) => m.role === "user").map((m) => m.content.trim()),
      );
      const optimistic = prev.filter(
        (m) =>
          m.role === "user" &&
          !incomingIds.has(m.id) &&
          !incomingUserTexts.has(m.content.trim()),
      );
      vlog("watch-client", "mergeMessages", { incoming: incoming.length, prev: prev.length, optimistic: optimistic.length });
      if (optimistic.length === 0) return incoming;
      // Keep unconfirmed optimistic user messages after server history (they are the latest).
      return [...incoming, ...optimistic];
    });
  }, []);

  const applyUpdate = useCallback((data: Record<string, unknown>) => {
    const incomingModified = typeof data.modifiedAt === "number" ? (data.modifiedAt as number) : 0;
    // Accept equal timestamps (live Date.now vs file mtime races) and bump a client seq
    // so history after a live stream is never dropped solely due to clock skew.
    const shouldApply =
      !incomingModified ||
      incomingModified >= lastModifiedRef.current ||
      Array.isArray(data.messages) ||
      Array.isArray(data.toolCalls);

    if (!shouldApply && Array.isArray(data.thoughts)) {
      setThoughts(data.thoughts as ThoughtInfo[]);
      return;
    }
    if (!shouldApply) return;

    if (incomingModified) {
      lastModifiedRef.current = Math.max(lastModifiedRef.current, incomingModified);
    }
    if (Array.isArray(data.messages) && (data.messages as ChatMessage[]).length > 0) {
      mergeMessages(data.messages as ChatMessage[]);
    }
    if (Array.isArray(data.toolCalls)) setToolCalls(data.toolCalls as ToolCallInfo[]);
    if (Array.isArray(data.thoughts)) setThoughts(data.thoughts as ThoughtInfo[]);
  }, [mergeMessages]);

  const startWatching = useCallback(
    (id: string, workspace?: string) => {
      stopWatching();
      lastModifiedRef.current = 0;

      let url = `/api/sessions/watch?id=${encodeURIComponent(id)}`;
      if (workspace) url += `&workspace=${encodeURIComponent(workspace)}`;
      vlog("watch-client", "startWatching: opening EventSource", { id, url });
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener("connected", (e) => {
        setIsWatching(true);
        try {
          const data = JSON.parse(e.data);
          vlog("watch-client", "connected event", {
            id, isActive: data.isActive,
            messages: data.messages?.length ?? 0,
            toolCalls: data.toolCalls?.length ?? 0,
            modifiedAt: data.modifiedAt,
          });
          if (data.isActive === true) {
            setIsActive(true);
            onStreamStartRef.current?.();
          } else {
            setIsActive(false);
            onStreamEndRef.current?.();
          }
          if (data.modifiedAt) lastModifiedRef.current = data.modifiedAt;
          if (data.messages?.length > 0) mergeMessages(data.messages);
          if (data.toolCalls?.length > 0) setToolCalls(data.toolCalls);
          if (Array.isArray(data.thoughts)) setThoughts(data.thoughts);
        } catch (err) {
          console.error("[watch] Failed to parse connected event");
          vlog("watch-client", "connected parse error", String(err));
        }
      });

      es.addEventListener("update", (e) => {
        try {
          const data = JSON.parse(e.data);
          vlog("watch-client", "update event", {
            id, isActive: data.isActive,
            messages: data.messages?.length ?? 0,
            toolCalls: data.toolCalls?.length ?? 0,
            thoughts: data.thoughts?.length ?? 0,
            modifiedAt: data.modifiedAt,
          });
          applyUpdate(data);

          if (data.isActive === false) {
            setIsActive(false);
            onStreamEndRef.current?.();
          } else if (data.isActive === true) {
            setIsActive(true);
          }
        } catch (err) {
          console.error("[watch] Failed to parse update event");
          vlog("watch-client", "update parse error", String(err));
        }
      });

      es.addEventListener("error", (e) => {
        vlog("watch-client", "EventSource error", { id, readyState: es.readyState, event: String(e) });
        if (es.readyState === EventSource.CLOSED) {
          setIsActive(false);
          setIsWatching(false);
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          onStreamEndRef.current?.();
        }
      });
    },
    [stopWatching, applyUpdate, mergeMessages],
  );

  const refreshFromHistory = useCallback(async (sessionId: string, workspace?: string) => {
    const t0 = Date.now();
    try {
      let url = `/api/sessions/history?id=${encodeURIComponent(sessionId)}`;
      if (workspace) url += `&workspace=${encodeURIComponent(workspace)}`;
      vlog("watch-client", "refreshFromHistory: fetch", { sessionId, url });
      const res = await apiFetch(url);
      vlog("watch-client", "refreshFromHistory: response", { sessionId, status: res.status, ok: res.ok });
      if (!res.ok) return;
      const data = await res.json();
      vlog("watch-client", "refreshFromHistory: data", {
        sessionId,
        messages: data.messages?.length ?? 0,
        toolCalls: data.toolCalls?.length ?? 0,
        modifiedAt: data.modifiedAt,
        ms: Date.now() - t0,
      });
      if (data.messages?.length > 0) mergeMessages(data.messages);
      if (data.toolCalls?.length > 0) setToolCalls(data.toolCalls);
      if (Array.isArray(data.thoughts)) setThoughts(data.thoughts);
      if (data.modifiedAt) lastModifiedRef.current = data.modifiedAt;
    } catch (err) {
      console.error("[watch] Failed to refresh from history");
      vlog("watch-client", "refreshFromHistory: error", { sessionId, error: String(err), ms: Date.now() - t0 });
    }
  }, [mergeMessages]);

  const resetState = useCallback(() => {
    vlog("watch-client", "resetState");
    setMessages([]);
    setToolCalls([]);
    setThoughts([]);
    setIsActive(false);
    lastModifiedRef.current = 0;
  }, []);

  useEffect(() => {
    return () => { stopWatching(); };
  }, [stopWatching]);

  return {
    messages,
    setMessages,
    toolCalls,
    setToolCalls,
    thoughts,
    setThoughts,
    isWatching,
    isActive,
    setIsActive,
    startWatching,
    stopWatching,
    refreshFromHistory,
    resetState,
    lastModifiedRef,
  };
}
