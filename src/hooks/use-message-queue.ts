"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { QueuedMessage, AgentMode } from "@/lib/types";
import { uuid } from "@/lib/uuid";

interface UseMessageQueueOptions {
  selectedModel: string;
  selectedMode: AgentMode;
}

export function useMessageQueue({ selectedModel, selectedMode }: UseMessageQueueOptions) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);

  useEffect(() => {
    queueRef.current = queuedMessages;
  }, [queuedMessages]);

  const enqueue = useCallback(
    (content: string, opts?: { skills?: string[] }) => {
      const msg: QueuedMessage = {
        id: uuid(),
        content,
        timestamp: Date.now(),
        model: selectedModel,
        mode: selectedMode,
        skills: opts?.skills,
      };
      setQueuedMessages((prev) => [...prev, msg]);
    },
    [selectedModel, selectedMode],
  );

  const dequeueNext = useCallback((): QueuedMessage | null => {
    const pending = queueRef.current;
    if (pending.length === 0) return null;
    const next = pending[0];
    setQueuedMessages((prev) => prev.slice(1));
    return next;
  }, []);

  const forceSendQueued = useCallback((id: string): QueuedMessage | null => {
    const msg = queueRef.current.find((m) => m.id === id);
    if (!msg) return null;
    setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
    return msg;
  }, []);

  const editQueued = useCallback((id: string, newContent: string) => {
    setQueuedMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: newContent } : m)));
  }, []);

  const deleteQueued = useCallback((id: string) => {
    setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setQueuedMessages([]);
  }, []);

  return {
    queuedMessages,
    enqueue,
    dequeueNext,
    forceSendQueued,
    editQueued,
    deleteQueued,
    clearQueue,
  };
}
