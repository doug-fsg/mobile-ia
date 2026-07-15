"use client";

import { useState, memo } from "react";
import type { ChatMessage } from "@/lib/types";
import { parseUserMessageContent } from "@/lib/message-display";
import { Markdown } from "./markdown";
import { useHaptics } from "@/hooks/use-haptics";
import { CheckIcon, CopyIcon } from "./icons";

interface MessageBubbleProps {
  message: ChatMessage;
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded text-text-muted hover:text-text-secondary"
      aria-label={copied ? "Copiado" : "Copiar mensagem"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function SkillChips({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 max-w-full px-1.5 py-0.5 rounded text-[10px] font-mono tracking-tight bg-accent-rail/12 text-accent-rail border border-accent-rail/25"
          title={`Skill /${name}`}
        >
          <span className="text-accent-rail/70">/</span>
          <span className="truncate">{name}</span>
        </span>
      ))}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const haptics = useHaptics();

  const parsed = isUser ? parseUserMessageContent(message.content) : null;
  const skillNames =
    message.skills?.length
      ? message.skills
      : parsed?.skills ?? [];
  const displayText = isUser ? (parsed?.text || message.content) : message.content;
  const copyText = displayText;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      haptics.tap();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };

  if (isUser) {
    return (
      <article
        className="msg-enter py-3 flex justify-end group"
        aria-label="Sua mensagem"
      >
        <div className="w-full max-w-[min(100%,34rem)] flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-accent-rail/80">
              Você
            </span>
            <CopyButton copied={copied} onClick={handleCopy} />
          </div>
          <div className="w-full rounded-lg rounded-tr-sm border border-border bg-bg-surface pl-0 overflow-hidden shadow-[inset_3px_0_0_0_var(--color-accent-rail)]">
            <div className="px-3 py-2.5">
              <SkillChips names={skillNames} />
              <div className="text-[13px] leading-[1.6] text-text whitespace-pre-wrap break-words">
                {displayText}
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="msg-enter py-3 group"
      aria-label="Resposta do Agent"
    >
      <div className="flex items-center gap-2 mb-1.5 px-0.5">
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full bg-success shrink-0"
          aria-hidden
        />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">
          Agent
        </span>
        <div className="ml-auto">
          <CopyButton copied={copied} onClick={handleCopy} />
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-3 py-2.5 pl-3 border-l-[3px] border-l-success/50">
        <Markdown content={displayText} />
      </div>
    </article>
  );
});
