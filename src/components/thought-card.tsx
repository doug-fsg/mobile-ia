"use client";

import { useState } from "react";
import type { ThoughtInfo } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { ChevronDown, Spinner } from "./icons";

interface ThoughtCardProps {
  thought: ThoughtInfo;
  defaultExpanded?: boolean;
}

function previewText(content: string, max = 72): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

export function ThoughtCard({ thought, defaultExpanded = false }: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const haptics = useHaptics();
  const isStreaming = thought.status === "streaming";

  return (
    <div className="py-1.5">
      <button
        onClick={() => {
          haptics.tap();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        aria-label="Raciocínio do modelo"
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <span className={isStreaming ? "text-text-secondary" : "text-text-muted"}>
          {isStreaming ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <svg
              className="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          )}
        </span>

        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`font-medium ${isStreaming ? "text-text-secondary" : "text-text-muted"}`}>
            Pensamento
          </span>
          {!expanded && (
            <span className="font-mono truncate text-text-muted/80">{previewText(thought.content)}</span>
          )}
        </span>

        <ChevronDown className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-border text-[11px] font-mono text-text-muted py-1.5 whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto">
          {thought.content}
          {isStreaming && <span className="animate-pulse"> ▍</span>}
        </div>
      )}
    </div>
  );
}
