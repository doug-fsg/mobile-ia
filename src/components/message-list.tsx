"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ChatMessage, ToolCallInfo, ThoughtInfo, StoredSession, QueuedMessage } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { timeAgo } from "@/lib/format";
import { MessageBubble } from "./message-bubble";
import { ToolCallCard, ToolCallGroup, TodoLogCard, ChangesSummary, isMinorToolCall } from "./tool-call-card";
import { ThoughtCard } from "./thought-card";
import { Spinner, RetryIcon, ClockIcon, ArrowDown } from "./icons";

interface MessageListProps {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  thoughts?: ThoughtInfo[];
  isStreaming: boolean;
  isLoadingHistory?: boolean;
  isWatching?: boolean;
  recentSessions?: StoredSession[];
  onSelectSession?: (id: string, workspace?: string) => void;
  onRetry?: () => void;
  queuedMessages?: QueuedMessage[];
  onForceSend?: (id: string) => void;
  onEditQueued?: (id: string, newContent: string) => void;
  onDeleteQueued?: (id: string) => void;
}

interface TimelineItem {
  kind: "message" | "toolcall" | "toolgroup" | "thought";
  timestamp: number;
  message?: ChatMessage;
  toolCall?: ToolCallInfo;
  toolCalls?: ToolCallInfo[];
  thought?: ThoughtInfo;
}

function RecentSessions({
  sessions,
  onSelect,
}: {
  sessions: StoredSession[];
  onSelect: (id: string, workspace?: string) => void;
}) {
  const haptics = useHaptics();
  if (sessions.length === 0) return null;

  return (
    <div className="mt-5 w-full max-w-xs">
      <p className="text-text-muted text-[11px] font-medium mb-2 uppercase tracking-wider">
        Sessões recentes
      </p>
      <div className="space-y-1">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => { haptics.tap(); onSelect(s.id, s.workspace); }}
            className="w-full text-left px-3 py-2 rounded-lg bg-bg-surface hover:bg-bg-hover border border-border/50 transition-colors group"
          >
            <p className="text-[12px] text-text-secondary group-hover:text-text truncate">
              {s.title}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5">{timeAgo(s.updatedAt)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function QueuedMessageCard({
  msg,
  onForceSend,
  onEdit,
  onDelete,
}: {
  msg: QueuedMessage;
  onForceSend: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const haptics = useHaptics();

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== msg.content) onEdit(trimmed);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(msg.content);
    setEditing(false);
  };

  return (
    <div className="py-2.5 border border-dashed border-text-muted/25 rounded-lg px-3 bg-bg-surface/50">
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5 text-text-muted/50">
          <ClockIcon />
        </span>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex flex-col gap-1.5">
              <textarea
                autoFocus
                aria-label="Editar mensagem na fila"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    save();
                  }
                  if (e.key === "Escape") cancel();
                }}
                rows={2}
                className="w-full resize-none bg-bg px-2 py-1.5 text-[13px] text-text rounded border border-border focus:outline-none focus:border-text-muted/40"
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={save}
                  className="px-2 py-0.5 text-[10px] font-medium rounded bg-bg-active text-text hover:bg-bg-hover transition-colors"
                >
                  Salvar
                </button>
                <button
                  onClick={cancel}
                  className="px-2 py-0.5 text-[10px] font-medium rounded text-text-muted hover:text-text-secondary transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-text-secondary whitespace-pre-wrap break-words">
              {msg.content}
            </p>
          )}
        </div>
      </div>
      {!editing && (
        <div className="flex items-center gap-1 mt-1.5 ml-5">
          <span className="text-[10px] text-text-muted/50 mr-1">Na fila</span>
          <button
            onClick={() => { haptics.send(); onForceSend(); }}
            className="px-2 py-0.5 text-[10px] font-medium rounded bg-bg-active text-text-secondary hover:text-text transition-colors"
            title="Parar o atual e enviar este agora"
          >
            Enviar agora
          </button>
          <button
            onClick={() => {
              haptics.tap();
              setDraft(msg.content);
              setEditing(true);
            }}
            className="px-2 py-0.5 text-[10px] font-medium rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Editar
          </button>
          <button
            onClick={() => { haptics.warn(); onDelete(); }}
            className="px-2 py-0.5 text-[10px] font-medium rounded text-text-muted hover:text-error/80 hover:bg-error/5 transition-colors"
          >
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  toolCalls,
  thoughts = [],
  isStreaming,
  isLoadingHistory,
  isWatching,
  recentSessions = [],
  onSelectSession,
  onRetry,
  queuedMessages = [],
  onForceSend,
  onEditQueued,
  onDeleteQueued,
}: MessageListProps) {
  const haptics = useHaptics();
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const isScrollingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
  }, []);

  const handleScroll = useCallback(() => {
    if (isScrollingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  const lastMsg = messages[messages.length - 1];
  const userJustSent = isStreaming && lastMsg?.role === "user";
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef(false);

  useEffect(() => {
    if (!autoScroll && !userJustSent) return;

    if (scrollThrottleRef.current) {
      pendingScrollRef.current = true;
      return;
    }

    isScrollingRef.current = true;
    endRef.current?.scrollIntoView({ behavior: "smooth" });

    scrollThrottleRef.current = setTimeout(() => {
      scrollThrottleRef.current = null;
      isScrollingRef.current = false;
      if (pendingScrollRef.current) {
        pendingScrollRef.current = false;
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }, 200);
  }, [messages, toolCalls, thoughts, autoScroll, userJustSent]);

  const sorted: TimelineItem[] = [
    ...messages.map((m): TimelineItem => ({ kind: "message", timestamp: m.timestamp, message: m })),
    ...toolCalls.map(
      (tc): TimelineItem => ({
        kind: "toolcall",
        timestamp: tc.timestamp,
        toolCall: tc,
      }),
    ),
    ...thoughts.map(
      (th): TimelineItem => ({
        kind: "thought",
        timestamp: th.timestamp,
        thought: th,
      }),
    ),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const timeline: TimelineItem[] = [];
  let minorBatch: ToolCallInfo[] = [];

  const flushMinor = () => {
    if (minorBatch.length === 0) return;
    if (minorBatch.length === 1) {
      timeline.push({
        kind: "toolcall",
        timestamp: minorBatch[0].timestamp,
        toolCall: minorBatch[0],
      });
    } else {
      timeline.push({
        kind: "toolgroup",
        timestamp: minorBatch[0].timestamp,
        toolCalls: [...minorBatch],
      });
    }
    minorBatch = [];
  };

  for (const item of sorted) {
    if (item.kind === "toolcall" && item.toolCall && isMinorToolCall(item.toolCall)) {
      minorBatch.push(item.toolCall);
    } else {
      flushMinor();
      timeline.push(item);
    }
  }
  flushMinor();

  if (isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-text-muted text-[13px]">
          <Spinner className="w-3.5 h-3.5" />
          Carregando sessão...
        </div>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="flex flex-col items-center max-w-sm">
          <p className="text-text-secondary text-[13px] font-medium mb-1">Cursor Remote</p>
          <p className="text-text-muted text-[12px] leading-relaxed">
            Envie uma mensagem para iniciar uma sessão do Agent.
          </p>
          {onSelectSession && (
            <RecentSessions sessions={recentSessions} onSelect={onSelectSession} />
          )}
        </div>
      </div>
    );
  }

  const hasRunningToolCalls = toolCalls.some((tc) => tc.status === "running");
  const lastItem = timeline[timeline.length - 1];
  const lastIsUser = lastItem?.kind === "message" && lastItem.message?.role === "user";
  const showThinking = isStreaming && !hasRunningToolCalls && lastIsUser;

  let lastTodoId: string | undefined;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const t = timeline[i];
    if (t.kind === "toolcall" && t.toolCall?.type === "todo") {
      lastTodoId = t.toolCall.id;
      break;
    }
  }

  const lastMessage = messages[messages.length - 1];
  const showRetry = !isStreaming && lastMessage?.role === "user" && onRetry;

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto"
      >
        <div className="px-4 max-w-3xl mx-auto w-full">
          <div className="divide-y divide-border/50">
            {timeline.map((item, i) => {
              if (item.kind === "message" && item.message) {
                return <MessageBubble key={item.message.id} message={item.message} />;
              }
              if (item.kind === "toolcall" && item.toolCall) {
                if (item.toolCall.type === "todo") {
                  return <TodoLogCard key={item.toolCall.id} toolCall={item.toolCall} defaultOpen={item.toolCall.id === lastTodoId} />;
                }
                return <ToolCallCard key={item.toolCall.id} toolCall={item.toolCall} />;
              }
              if (item.kind === "toolgroup" && item.toolCalls) {
                return <ToolCallGroup key={`group-${i}`} toolCalls={item.toolCalls} />;
              }
              if (item.kind === "thought" && item.thought) {
                return <ThoughtCard key={item.thought.id} thought={item.thought} />;
              }
              return null;
            })}
          </div>

          {!isStreaming && timeline.length > 0 && toolCalls.length > 0 && (
            <ChangesSummary toolCalls={toolCalls} />
          )}

          {showThinking && (
            <div className="py-3 flex items-center gap-2 text-text-muted text-[12px]">
              <Spinner />
              Pensando...
            </div>
          )}

          {isWatching && !isStreaming && timeline.length > 0 && (
            <div className="py-3 flex items-center gap-2 text-text-muted text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Aguardando atualizações...
            </div>
          )}

          {showRetry && (
            <div className="py-1">
              <button
                onClick={() => { haptics.tap(); onRetry?.(); }}
                className="flex items-center gap-1 text-[10px] text-text-muted/60 hover:text-text-muted transition-colors"
                aria-label="Tentar novamente a última mensagem"
              >
                <RetryIcon />
                Tentar novamente a última mensagem
              </button>
            </div>
          )}

          {queuedMessages.length > 0 && (
            <div className="space-y-2 py-2">
              {queuedMessages.map((msg) => (
                <QueuedMessageCard
                  key={msg.id}
                  msg={msg}
                  onForceSend={() => onForceSend?.(msg.id)}
                  onEdit={(content) => onEditQueued?.(msg.id, content)}
                  onDelete={() => onDeleteQueued?.(msg.id)}
                />
              ))}
            </div>
          )}

          <div ref={endRef} className="h-4" />
        </div>
      </div>

      {!autoScroll && timeline.length > 0 && (
        <button
          onClick={scrollToBottom}
          aria-label="Rolar para o final"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-elevated border border-border text-text-muted hover:text-text-secondary text-[11px] shadow-lg transition-colors"
        >
          <ArrowDown />
          Rolar para o final
        </button>
      )}
    </div>
  );
}
