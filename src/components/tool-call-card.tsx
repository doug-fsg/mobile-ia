"use client";

import { useState } from "react";
import type { ToolCallInfo } from "@/lib/types";
import { useHaptics } from "@/hooks/use-haptics";
import { ChevronDown, Spinner } from "./icons";

const IMPORTANT_TYPES = new Set(["edit", "write", "shell", "todo"]);

const GEAR_PATH =
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d={GEAR_PATH} />
    </svg>
  );
}

export function isMinorToolCall(tc: ToolCallInfo): boolean {
  return !IMPORTANT_TYPES.has(tc.type);
}

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
  defaultExpanded?: boolean;
}

function TypeIcon({ type }: { type: ToolCallInfo["type"] }) {
  const cls = "w-3.5 h-3.5 shrink-0";

  switch (type) {
    case "read":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "write":
    case "edit":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case "shell":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "search":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "todo":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    default:
      return <GearIcon className={cls} />;
  }
}

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return ".../" + parts.slice(-2).join("/");
}

function TodoStatusIcon({ status }: { status: string }) {
  const cls = "w-3 h-3 shrink-0 mt-0.5";
  if (status.includes("COMPLETED")) {
    return (
      <svg
        className={`${cls} text-text-secondary`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status.includes("IN_PROGRESS")) {
    return <Spinner className={cls} />;
  }
  return (
    <svg
      className={`${cls} text-text-muted`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+")) return "text-green-400/70";
  if (line.startsWith("-")) return "text-red-400/70";
  return "text-text-muted";
}

function DiffBlock({ diff, startLine }: { diff: string; startLine?: number }) {
  const lines = diff.split("\n");
  const hasLineNums = startLine !== undefined;
  let oldLine = startLine ?? 1;
  let newLine = startLine ?? 1;

  const lineNums: Array<string> = [];
  if (hasLineNums) {
    for (const line of lines) {
      if (line.startsWith("-")) {
        lineNums.push(String(oldLine));
        oldLine++;
      } else if (line.startsWith("+")) {
        lineNums.push(String(newLine));
        newLine++;
      } else {
        lineNums.push(String(newLine));
        oldLine++;
        newLine++;
      }
    }
  }

  const gutterWidth = hasLineNums ? String(Math.max(oldLine, newLine)).length : 0;

  return (
    <pre className="bg-[#0d0d0d] rounded px-2 py-1.5 text-[11px] whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
      {lines.map((line, i) => (
        <span key={i} className={diffLineClass(line)}>
          {hasLineNums && (
            <span
              className="text-text-muted/40 select-none inline-block mr-2"
              style={{ width: `${gutterWidth}ch`, textAlign: "right" }}
            >
              {lineNums[i]}
            </span>
          )}
          {line}
          {i < lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </pre>
  );
}

function actionLabel(tc: ToolCallInfo): string {
  switch (tc.type) {
    case "read":
      return "Lendo";
    case "write":
      return "Escrevendo";
    case "edit":
      return "Editando";
    case "shell":
      return "Executando";
    case "search":
      return "Buscando";
    case "todo":
      return "Atualizando";
    default:
      return tc.name;
  }
}

function summaryText(tc: ToolCallInfo): string {
  if (tc.type === "shell" && tc.command) {
    return tc.command;
  }

  if (tc.type === "search" && tc.command) {
    const dir = tc.path ? ` em ${shortenPath(tc.path)}` : "";
    return `"${tc.command}"${dir}`;
  }

  if (tc.type === "todo") {
    return "lista Todo";
  }

  if (tc.path) {
    return shortenPath(tc.path);
  }

  return tc.name;
}

function groupSummary(calls: ToolCallInfo[]): string {
  const counts: Record<string, number> = {};
  for (const tc of calls) {
    const label = tc.name || tc.type;
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
}

export function ToolCallGroup({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const haptics = useHaptics();
  const allDone = toolCalls.every((tc) => tc.status === "completed");
  const statusColor = allDone ? "text-text-muted" : "text-text-secondary";

  return (
    <div className="py-1.5">
      <button
        onClick={() => { haptics.tap(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label={`Grupo de ferramentas: ${groupSummary(toolCalls)}`}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <span className={statusColor}>
          {!allDone ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <GearIcon className="w-3.5 h-3.5 shrink-0" />
          )}
        </span>

        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono text-text-muted truncate">{groupSummary(toolCalls)}</span>
        </span>

        <ChevronDown className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="ml-5 pl-3 border-l-2 border-border">
          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolCallCard({ toolCall, defaultExpanded }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const haptics = useHaptics();
  const isRunning = toolCall.status === "running";

  const statusColor = isRunning ? "text-text-secondary" : "text-text-muted";

  return (
    <div className="py-1.5">
      <button
        onClick={() => { haptics.tap(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label={`${actionLabel(toolCall)} ${summaryText(toolCall)}`}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <span className={statusColor}>
          {isRunning ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <TypeIcon type={toolCall.type} />
          )}
        </span>

        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`font-medium ${isRunning ? "text-text-secondary" : "text-text-muted"}`}>
            {actionLabel(toolCall)}
          </span>
          <span className="font-mono truncate">{summaryText(toolCall)}</span>
        </span>

        {toolCall.result && (
          <span className="text-text-muted text-[11px] shrink-0">{toolCall.result}</span>
        )}

        <ChevronDown className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-border text-[11px] font-mono text-text-muted py-1.5 space-y-1 overflow-x-auto">
          <p className="text-text-secondary">{toolCall.name}</p>

          {toolCall.path && <p className="break-all">{toolCall.path}</p>}

          {toolCall.type === "shell" && toolCall.command && (
            <pre className="bg-[#0d0d0d] rounded px-2 py-1.5 text-[11px] text-[#c9d1d9] whitespace-pre-wrap break-all">
              $ {toolCall.command}
            </pre>
          )}

          {toolCall.type === "search" && toolCall.command && (
            <p>
              pattern: <span className="text-text-secondary">{toolCall.command}</span>
            </p>
          )}

          {toolCall.todos && toolCall.todos.length > 0 && (
            <ul className="space-y-0.5">
              {toolCall.todos.map((t) => (
                <li key={t.id} className="flex items-start gap-1.5">
                  <TodoStatusIcon status={t.status} />
                  <span
                    className={
                      t.status.includes("COMPLETED")
                        ? "text-text-muted line-through"
                        : "text-text-secondary"
                    }
                  >
                    {t.content}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {toolCall.diff && <DiffBlock diff={toolCall.diff} startLine={toolCall.diffStartLine} />}

          {!toolCall.diff && !toolCall.todos && toolCall.result && (
            <p className="text-text-secondary">{toolCall.result}</p>
          )}

          {isRunning && <p className="text-text-muted animate-pulse">executando...</p>}
        </div>
      )}
    </div>
  );
}

interface FileChange {
  path: string;
  shortPath: string;
  writes: number;
  edits: number;
  diffs: { diff: string; startLine?: number }[];
}

function aggregateFileChanges(toolCalls: ToolCallInfo[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const tc of toolCalls) {
    if ((tc.type !== "write" && tc.type !== "edit") || !tc.path) continue;
    let entry = byPath.get(tc.path);
    if (!entry) {
      entry = { path: tc.path, shortPath: shortenPath(tc.path), writes: 0, edits: 0, diffs: [] };
      byPath.set(tc.path, entry);
    }
    if (tc.type === "write") entry.writes++;
    else entry.edits++;
    if (tc.diff) entry.diffs.push({ diff: tc.diff, startLine: tc.diffStartLine });
  }
  return Array.from(byPath.values()).sort((a, b) => (b.writes + b.edits) - (a.writes + a.edits));
}

function FileChangeRow({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(false);
  const haptics = useHaptics();
  const hasDiffs = change.diffs.length > 0;

  return (
    <li>
      <button
        onClick={() => { if (hasDiffs) { haptics.tap(); setOpen((v) => !v); } }}
        className={`flex items-center gap-2 text-[11px] font-mono w-full text-left py-0.5 ${hasDiffs ? "hover:text-text-secondary cursor-pointer" : ""}`}
      >
        <svg
          className="w-3 h-3 shrink-0 text-text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <span className="text-text-secondary truncate flex-1" title={change.path}>{change.shortPath}</span>
        <span className="text-text-muted shrink-0">
          {change.edits > 0 && change.writes > 0
            ? `${change.edits}e ${change.writes}w`
            : change.edits > 0
              ? `${change.edits} Edit`
              : `${change.writes} Write`}
        </span>
        {hasDiffs && <ChevronDown className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && change.diffs.map((d, i) => (
        <div key={i} className="mt-1 mb-2">
          <DiffBlock diff={d.diff} startLine={d.startLine} />
        </div>
      ))}
    </li>
  );
}

export function ChangesSummary({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const haptics = useHaptics();
  const changes = aggregateFileChanges(toolCalls);
  if (changes.length === 0) return null;

  const totalEdits = changes.reduce((s, c) => s + c.edits, 0);
  const totalWrites = changes.reduce((s, c) => s + c.writes, 0);
  const parts: string[] = [];
  if (totalEdits > 0) parts.push(`${totalEdits} Edit`);
  if (totalWrites > 0) parts.push(`${totalWrites} Write`);

  return (
    <div className="py-2">
      <button
        onClick={() => { haptics.tap(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label={`Resumo de alterações: ${changes.length} arquivos`}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        <span className="font-medium text-text-secondary">
          {changes.length} arquivo{changes.length > 1 ? "s" : ""} alterado{changes.length > 1 ? "s" : ""}
        </span>
        <span className="text-text-muted text-[11px]">{parts.join(", ")}</span>
        <ChevronDown className={`shrink-0 transition-transform ml-auto ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <ul className="mt-1.5 ml-5 pl-3 border-l-2 border-border space-y-0.5 py-1">
          {changes.map((c) => <FileChangeRow key={c.path} change={c} />)}
        </ul>
      )}
    </div>
  );
}

export function TodoLogCard({ toolCall, defaultOpen = true }: { toolCall: ToolCallInfo; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const haptics = useHaptics();
  const todos = toolCall.todos;
  if (!todos || todos.length === 0) return null;

  const done = todos.filter((t) => t.status.includes("COMPLETED")).length;
  const inProgress = todos.filter((t) => t.status.includes("IN_PROGRESS")).length;

  return (
    <div className="py-2">
      <button
        onClick={() => { haptics.tap(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label={`Lista Todo: ${done}/${todos.length} concluídos`}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span className="font-medium text-text-secondary">Todo</span>
        <span className="text-text-muted text-[11px]">
          {done}/{todos.length} concluídos{inProgress > 0 ? ` · ${inProgress} ativos` : ""}
        </span>
        <ChevronDown className={`shrink-0 transition-transform ml-auto ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-1.5 ml-5 pl-3 border-l-2 border-border space-y-0.5 py-1">
          {todos.map((t) => (
            <li key={t.id} className="flex items-start gap-1.5 text-[11px] font-mono">
              <TodoStatusIcon status={t.status} />
              <span
                className={
                  t.status.includes("COMPLETED")
                    ? "text-text-muted line-through"
                    : "text-text-secondary"
                }
              >
                {t.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
