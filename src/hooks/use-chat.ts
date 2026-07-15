"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, AgentMode } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { uuid } from "@/lib/uuid";
import { STREAMING_HEALTH_CHECK_MS } from "@/lib/constants";
import { vlog } from "@/lib/verbose";
import { parseUserMessageContent } from "@/lib/message-display";
import { useSessionWatch } from "./use-session-watch";
import { useMessageQueue } from "./use-message-queue";

interface UseChatReturn {
  messages: ChatMessage[];
  toolCalls: ReturnType<typeof useSessionWatch>["toolCalls"];
  thoughts: ReturnType<typeof useSessionWatch>["thoughts"];
  sessionId: string | null;
  isStreaming: boolean;
  isLoadingHistory: boolean;
  isWatching: boolean;
  model: string | null;
  selectedModel: string;
  selectedMode: AgentMode;
  worktree: boolean;
  error: string | null;
  queuedMessages: ReturnType<typeof useMessageQueue>["queuedMessages"];
  sendMessage: (
    prompt: string,
    overrides?: { model?: string; mode?: AgentMode; skills?: string[] },
  ) => Promise<void>;
  loadSession: (id: string, workspace?: string) => Promise<void>;
  setSessionId: (id: string | null) => void;
  setSelectedModel: (model: string) => void;
  setSelectedMode: (mode: AgentMode) => void;
  setWorktree: (enabled: boolean) => void;
  clearChat: () => void;
  stopStreaming: () => void;
  retryLastMessage: () => void;
  forceSendQueued: (id: string) => void;
  editQueued: (id: string, newContent: string) => void;
  deleteQueued: (id: string) => void;
}

async function fetchActiveSessions(): Promise<string[]> {
  try {
    const res = await apiFetch("/api/sessions/active");
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}

export { fetchActiveSessions };

export function useChat(initialModel = "auto", initialWorkspace?: string): UseChatReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(initialModel);
  const [selectedMode, setSelectedMode] = useState<AgentMode>("agent");
  const [worktree, setWorktree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const workspaceRef = useRef<string | undefined>(initialWorkspace);
  const isStreamingRef = useRef(false);
  const worktreeRef = useRef(false);
  const sendMessageRef = useRef<
    | ((
        prompt: string,
        overrides?: { model?: string; mode?: AgentMode; skills?: string[] },
      ) => Promise<void>)
    | undefined
  >(undefined);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { worktreeRef.current = worktree; }, [worktree]);
  useEffect(() => { if (!sessionId) workspaceRef.current = initialWorkspace; }, [initialWorkspace, sessionId]);

  const handleStreamEnd = useCallback(() => {
    setIsStreaming(false);
    const queue = queueHook;
    const next = queue.dequeueNext();
    if (next) {
      const overrides = {
        model: next.model,
        mode: next.mode,
        skills: next.skills,
      };
      setTimeout(() => { sendMessageRef.current?.(next.content, overrides); }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStreamStart = useCallback(() => setIsStreaming(true), []);

  const watch = useSessionWatch({
    onStreamEnd: handleStreamEnd,
    onStreamStart: handleStreamStart,
  });

  const queueHook = useMessageQueue({ selectedModel, selectedMode });

  const clearChat = useCallback(() => {
    watch.stopWatching();
    watch.resetState();
    setSessionId(null);
    workspaceRef.current = initialWorkspace;
    setModel(null);
    setError(null);
    setIsStreaming(false);
    queueHook.clearQueue();
  }, [watch, queueHook]);

  const stopStreaming = useCallback(() => {
    if (sessionIdRef.current) {
      apiFetch("/api/sessions/active", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch((err) => console.error("[chat] Failed to stop streaming:", err));
    }
    setIsStreaming(false);
  }, []);

  const loadSession = useCallback(
    async (id: string, workspace?: string) => {
      const t0 = Date.now();
      vlog("chat", "loadSession start", { id, workspace });

      watch.stopWatching();
      watch.resetState();
      setIsLoadingHistory(true);
      setError(null);
      setSessionId(id);
      workspaceRef.current = workspace;

      try {
        vlog("chat", "loadSession: refreshFromHistory", { id, workspace });
        await watch.refreshFromHistory(id, workspace);
        vlog("chat", "loadSession: refreshFromHistory done", { id, ms: Date.now() - t0 });

        vlog("chat", "loadSession: startWatching", { id, workspace });
        watch.startWatching(id, workspace);

        vlog("chat", "loadSession: checking active sessions");
        const active = await fetchActiveSessions();
        const isSessionActive = active.includes(id);
        vlog("chat", "loadSession: active check", { id, isSessionActive, activeSessions: active.length });
        if (isSessionActive) {
          setIsStreaming(true);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha ao carregar sessão";
        vlog("chat", "loadSession: error", { id, error: msg, ms: Date.now() - t0 });
        setError(msg);
      } finally {
        vlog("chat", "loadSession: done", { id, ms: Date.now() - t0 });
        setIsLoadingHistory(false);
      }
    },
    [watch],
  );

  const sendMessage = useCallback(
    async (prompt: string, overrides?: { model?: string; mode?: AgentMode; skills?: string[] }) => {
      if (isStreamingRef.current) {
        queueHook.enqueue(prompt, { skills: overrides?.skills });
        return;
      }

      watch.stopWatching();
      setError(null);
      setIsStreaming(true);

      const skills = overrides?.skills?.length ? overrides.skills : undefined;
      const userMessage: ChatMessage = {
        id: uuid(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        skills,
      };
      watch.setMessages((prev) => [...prev, userMessage]);

      const effectiveModel = overrides?.model ?? selectedModel;
      const effectiveMode = overrides?.mode ?? selectedMode;

      try {
        const res = await apiFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            sessionId: sessionIdRef.current ?? undefined,
            model: effectiveModel !== "auto" ? effectiveModel : undefined,
            mode: effectiveMode !== "agent" ? effectiveMode : undefined,
            workspace: workspaceRef.current,
            worktree: !sessionIdRef.current && worktreeRef.current ? true : undefined,
            skills,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const newSessionId = data.sessionId as string;

        sessionIdRef.current = newSessionId;
        setSessionId(newSessionId);
        if (data.model) setModel(data.model);

        watch.startWatching(newSessionId, workspaceRef.current);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setIsStreaming(false);
      }
    },
    [selectedModel, selectedMode, watch, queueHook],
  );

  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const sid = sessionIdRef.current;
      if (!sid) return;

      try {
        await watch.refreshFromHistory(sid, workspaceRef.current);
        const active = await fetchActiveSessions();
        setIsStreaming(active.includes(sid));
        setError(null);
        if (!watch.isWatching) watch.startWatching(sid, workspaceRef.current);
      } catch {
        console.error("[chat] Failed to refresh on visibility change");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [watch]);

  const forceSendQueued = useCallback((id: string) => {
    const msg = queueHook.forceSendQueued(id);
    if (!msg) return;
    setIsStreaming(false);
    const overrides = {
      model: msg.model,
      mode: msg.mode,
      skills: msg.skills,
    };
    setTimeout(() => { sendMessageRef.current?.(msg.content, overrides); }, 0);
  }, [queueHook]);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(async () => {
      const sid = sessionIdRef.current;
      if (!sid || !isStreamingRef.current) return;
      try {
        const active = await fetchActiveSessions();
        if (!active.includes(sid)) {
          setIsStreaming(false);
          await watch.refreshFromHistory(sid, workspaceRef.current);
        }
      } catch { /* ignore */ }
    }, STREAMING_HEALTH_CHECK_MS);
    return () => clearInterval(timer);
  }, [isStreaming, watch]);

  const retryLastMessage = useCallback(() => {
    if (isStreamingRef.current) return;
    const msgs = watch.messages;
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const parsed = parseUserMessageContent(lastUserMsg.content);
    const prompt = parsed.text || lastUserMsg.content;
    const skills =
      lastUserMsg.skills?.length
        ? lastUserMsg.skills
        : parsed.skills.length
          ? parsed.skills
          : undefined;

    const idx = msgs.findIndex((m) => m.id === lastUserMsg.id);
    if (idx >= 0) {
      watch.setMessages(msgs.slice(0, idx));
    }
    watch.setToolCalls((prev) => prev.filter((tc) => tc.timestamp < lastUserMsg.timestamp));
    void sendMessage(prompt, skills?.length ? { skills } : undefined).catch((err) =>
      console.error("[chat] Retry failed:", err),
    );
  }, [watch, sendMessage]);

  return {
    messages: watch.messages,
    toolCalls: watch.toolCalls,
    thoughts: watch.thoughts,
    sessionId,
    isStreaming,
    isLoadingHistory,
    isWatching: watch.isWatching,
    model,
    selectedModel,
    selectedMode,
    worktree,
    error,
    queuedMessages: queueHook.queuedMessages,
    sendMessage,
    loadSession,
    setSessionId,
    setSelectedModel,
    setSelectedMode,
    setWorktree,
    clearChat,
    stopStreaming,
    retryLastMessage,
    forceSendQueued,
    editQueued: queueHook.editQueued,
    deleteQueued: queueHook.deleteQueued,
  };
}
