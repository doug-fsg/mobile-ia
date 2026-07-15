import { joinMessageContent } from "@/lib/markdown-normalize";
import type { ChatMessage, ThoughtInfo, TodoItem, ToolCallInfo } from "@/lib/types";

export interface ParsedTimeline {
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  thoughts: ThoughtInfo[];
}

const TOOL_NAME_MAP: Record<string, ToolCallInfo["type"]> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  StrReplace: "edit",
  Shell: "shell",
  Grep: "search",
  Glob: "search",
  List: "read",
  TodoWrite: "todo",
};

const THINKING_TAG_RE =
  /<(?:thinking|think|redacted_thinking)>([\s\S]*?)<\/(?:thinking|think|redacted_thinking)>/gi;

function stripXmlTags(text: string): string {
  return text
    .replace(/<user_query>\s*/gi, "")
    .replace(/\s*<\/user_query>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractThinkingFromText(text: string): { cleaned: string; thoughts: string[] } {
  const thoughts: string[] = [];
  if (!/<(?:thinking|think|redacted_thinking)\b/i.test(text)) {
    return { cleaned: text, thoughts };
  }
  const cleaned = text
    .replace(THINKING_TAG_RE, (_m, body: string) => {
      const t = body.trim();
      if (t) thoughts.push(t);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n");
  return { cleaned, thoughts };
}

function thoughtTextFromPart(part: Record<string, unknown>): string | null {
  const type = part.type as string | undefined;
  if (type !== "thinking" && type !== "reasoning") return null;
  const raw =
    (typeof part.thinking === "string" && part.thinking) ||
    (typeof part.reasoning === "string" && part.reasoning) ||
    (typeof part.text === "string" && part.text) ||
    "";
  const trimmed = raw.trim();
  return trimmed || null;
}

/** Whether stream-json assistant events use --stream-partial-output duplicate flushes. */
export function detectPartialAssistantStream(events: Record<string, unknown>[]): boolean {
  return events.some(
    (e) => e.type === "assistant" && typeof e.timestamp_ms === "number",
  );
}

/**
 * With --stream-partial-output, only deltas (timestamp_ms, no model_call_id) carry new text.
 * Pre-tool and final flushes are duplicates and must be skipped for text.
 */
export function isDuplicateAssistantTextEvent(
  event: Record<string, unknown>,
  partialMode: boolean,
): boolean {
  if (!partialMode || event.type !== "assistant") return false;
  const hasTs = typeof event.timestamp_ms === "number";
  const hasModelCall =
    typeof event.model_call_id === "string" && (event.model_call_id as string).length > 0;
  if (hasTs && hasModelCall) return true;
  if (!hasTs && !hasModelCall) return true;
  return false;
}

function toolInfoFromUse(
  part: Record<string, unknown>,
  sessionId: string,
  seq: number,
  timestamp: number,
): ToolCallInfo {
  const name = (part.name as string) || "Tool";
  const input = (part.input as Record<string, unknown>) || {};
  const type = TOOL_NAME_MAP[name] || "other";
  const rawId = typeof part.id === "string" ? part.id : `${sessionId}-tc-${seq}`;

  let todos: TodoItem[] | undefined;
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    todos = (input.todos as Record<string, string>[]).map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status?.toUpperCase().includes("COMPLETED")
        ? "TODO_STATUS_COMPLETED"
        : t.status?.toUpperCase().includes("PROGRESS")
          ? "TODO_STATUS_IN_PROGRESS"
          : "TODO_STATUS_PENDING",
    }));
  }

  const done = todos?.filter((t) => t.status.includes("COMPLETED")).length ?? 0;
  const total = todos?.length ?? 0;

  let toolDiff: string | undefined;
  let toolDiffStartLine: number | undefined;
  if (type === "edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
    const oldLines = input.old_string.split("\n").map((l) => `-${l}`);
    const newLines = input.new_string.split("\n").map((l) => `+${l}`);
    toolDiff = [...oldLines, ...newLines].join("\n");
  } else if (type === "write" && typeof input.contents === "string") {
    const lines = input.contents.split("\n");
    toolDiff = lines.map((l) => `+${l}`).join("\n");
    if (lines.length > 30) {
      toolDiff =
        lines.slice(0, 30).map((l) => `+${l}`).join("\n") +
        "\n+... (" +
        (lines.length - 30) +
        " more lines)";
    }
  }
  if (typeof input.start_line === "number") {
    toolDiffStartLine = input.start_line;
  }

  return {
    id: `${sessionId}-tc-${seq}`,
    callId: rawId,
    type,
    name,
    path: (input.path || input.file_path) as string | undefined,
    command:
      type === "shell"
        ? (input.command as string)
        : type === "search"
          ? (input.pattern as string)
          : undefined,
    status: "completed",
    diff: toolDiff,
    diffStartLine: toolDiffStartLine,
    result: type === "todo" && total > 0 ? `${total} items · ${done} done` : undefined,
    todos,
    timestamp,
  };
}

type StreamToolKey =
  | "readToolCall"
  | "writeToolCall"
  | "editToolCall"
  | "shellToolCall"
  | "grepToolCall"
  | "globToolCall"
  | "function";

function parseStreamToolPayload(
  toolCall: Record<string, unknown>,
  callId: string,
  sessionId: string,
  seq: number,
  timestamp: number,
): ToolCallInfo {
  const entries = Object.entries(toolCall);
  let name = "Tool";
  let type: ToolCallInfo["type"] = "other";
  let path: string | undefined;
  let command: string | undefined;
  let diff: string | undefined;
  let todos: TodoItem[] | undefined;

  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== "object") continue;
    const body = raw as Record<string, unknown>;
    const args = (body.args as Record<string, unknown>) || {};

    switch (key as StreamToolKey | string) {
      case "readToolCall":
        name = "Read";
        type = "read";
        path = args.path as string | undefined;
        break;
      case "writeToolCall":
        name = "Write";
        type = "write";
        path = args.path as string | undefined;
        if (typeof args.fileText === "string") {
          const lines = (args.fileText as string).split("\n");
          diff = lines.slice(0, 30).map((l) => `+${l}`).join("\n");
          if (lines.length > 30) diff += `\n+... (${lines.length - 30} more lines)`;
        }
        break;
      case "editToolCall":
        name = "Edit";
        type = "edit";
        path = args.path as string | undefined;
        break;
      case "shellToolCall":
        name = "Shell";
        type = "shell";
        command = (args.command as string) || (args.cmd as string);
        break;
      case "grepToolCall":
        name = "Grep";
        type = "search";
        command = args.pattern as string | undefined;
        path = args.path as string | undefined;
        break;
      case "globToolCall":
        name = "Glob";
        type = "search";
        command = (args.glob_pattern as string) || (args.pattern as string);
        path = args.target_directory as string | undefined;
        break;
      case "function": {
        name = (body.name as string) || "Tool";
        type = TOOL_NAME_MAP[name] || "other";
        let argsObj = args;
        if (typeof body.arguments === "string") {
          try {
            argsObj = JSON.parse(body.arguments as string) as Record<string, unknown>;
          } catch {
            argsObj = {};
          }
        }
        path = (argsObj.path || argsObj.file_path) as string | undefined;
        command =
          type === "shell"
            ? (argsObj.command as string)
            : type === "search"
              ? (argsObj.pattern as string)
              : undefined;
        break;
      }
      default:
        break;
    }
  }

  return {
    id: `${sessionId}-tc-${seq}`,
    callId,
    type,
    name,
    path,
    command,
    status: "running",
    diff,
    todos,
    timestamp,
  };
}

function applyToolCallResult(existing: ToolCallInfo, toolCall: Record<string, unknown>): void {
  existing.status = "completed";
  for (const raw of Object.values(toolCall)) {
    if (!raw || typeof raw !== "object") continue;
    const body = raw as Record<string, unknown>;
    const result = body.result as Record<string, unknown> | undefined;
    if (!result) continue;
    const success = result.success as Record<string, unknown> | undefined;
    if (success) {
      if (typeof success.content === "string") {
        const c = success.content as string;
        existing.result = c.length > 120 ? `${c.slice(0, 117)}...` : c;
      } else if (typeof success.linesCreated === "number") {
        existing.result = `${success.linesCreated} lines`;
      } else if (typeof success.path === "string") {
        existing.result = success.path as string;
      }
    }
    if (result.error) {
      existing.status = "error";
      existing.result = typeof result.error === "string" ? result.error : "error";
    }
  }
}

/**
 * Incremental timeline builder. Text segments stay open until a tool/thought
 * breaks them, so tools interleave chronologically instead of stacking at the end.
 */
export function createTimelineBuilder(sessionId: string, baseTimestamp: number) {
  const messages: ChatMessage[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const thoughts: ThoughtInfo[] = [];
  const toolByCallId = new Map<string, ToolCallInfo>();
  let seq = 0;
  let openMessage: ChatMessage | null = null;

  function nextTs(): number {
    seq += 1;
    return baseTimestamp + seq;
  }

  function breakOpenMessage(): void {
    openMessage = null;
  }

  function appendText(role: "user" | "assistant", text: string): void {
    if (!text) return;
    if (openMessage && openMessage.role === role) {
      openMessage.content = joinMessageContent(openMessage.content, text);
      return;
    }
    const msg: ChatMessage = {
      id: `${sessionId}-m-${seq + 1}`,
      role,
      content: text,
      timestamp: nextTs(),
    };
    messages.push(msg);
    openMessage = msg;
  }

  function pushThought(content: string, status: ThoughtInfo["status"] = "completed"): void {
    if (!content.trim()) return;
    breakOpenMessage();
    const prev = thoughts[thoughts.length - 1];
    if (prev && prev.status === "streaming" && status === "streaming") {
      prev.content += content;
      return;
    }
    thoughts.push({
      id: `${sessionId}-th-${seq + 1}`,
      content: content.trim(),
      status,
      timestamp: nextTs(),
    });
  }

  function pushToolFromUse(part: Record<string, unknown>): void {
    breakOpenMessage();
    const ts = nextTs();
    const info = toolInfoFromUse(part, sessionId, seq, ts);
    toolByCallId.set(info.callId, info);
    toolCalls.push(info);
  }

  function ingestContentParts(role: "user" | "assistant", contentArr: unknown[]): void {
    for (const part of contentArr) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;

      const thought = thoughtTextFromPart(p);
      if (thought) {
        pushThought(thought, "completed");
        continue;
      }

      if (p.type === "tool_use") {
        pushToolFromUse(p);
        continue;
      }

      if (p.type === "text" && typeof p.text === "string") {
        let text = p.text;
        if (role === "user") {
          text = stripXmlTags(text);
          if (text.trim()) appendText("user", text);
        } else {
          const extracted = extractThinkingFromText(text);
          for (const t of extracted.thoughts) pushThought(t, "completed");
          if (extracted.cleaned) appendText("assistant", extracted.cleaned);
        }
      }
    }
  }

  function ingestJsonlEntry(entry: Record<string, unknown>): void {
    const role = entry.role as string;
    if (role !== "user" && role !== "assistant") return;
    const contentArr = (entry.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(contentArr)) return;
    ingestContentParts(role, contentArr);
  }

  function ingestLiveEvent(event: Record<string, unknown>, partialMode: boolean): void {
    const eventType = event.type as string;

    if (eventType === "thinking") {
      const subtype = event.subtype as string | undefined;
      if (subtype === "completed") {
        const last = thoughts[thoughts.length - 1];
        if (last) last.status = "completed";
        return;
      }
      const delta =
        (typeof event.text === "string" && event.text) ||
        (typeof event.delta === "string" && event.delta) ||
        "";
      if (delta) pushThought(delta, "streaming");
      return;
    }

    if (eventType === "tool_call") {
      const callId = String(event.call_id ?? "");
      if (!callId) return;
      const subtype = event.subtype as string | undefined;
      const payload = (event.tool_call as Record<string, unknown>) || {};

      if (subtype === "started") {
        breakOpenMessage();
        const ts = nextTs();
        const info = parseStreamToolPayload(payload, callId, sessionId, seq, ts);
        info.status = "running";
        toolByCallId.set(callId, info);
        toolCalls.push(info);
        return;
      }

      if (subtype === "completed") {
        const existing = toolByCallId.get(callId);
        if (existing) {
          applyToolCallResult(existing, payload);
        } else {
          breakOpenMessage();
          const ts = nextTs();
          const info = parseStreamToolPayload(payload, callId, sessionId, seq, ts);
          applyToolCallResult(info, payload);
          toolByCallId.set(callId, info);
          toolCalls.push(info);
        }
        return;
      }
      return;
    }

    if (eventType !== "user" && eventType !== "assistant") return;

    if (isDuplicateAssistantTextEvent(event, partialMode)) {
      // Flushes can still carry tool_use in some builds — keep tools, drop text.
      const contentArr = (event.message as Record<string, unknown> | undefined)?.content;
      if (Array.isArray(contentArr)) {
        for (const part of contentArr) {
          if (typeof part !== "object" || part === null) continue;
          const p = part as Record<string, unknown>;
          if (p.type === "tool_use") pushToolFromUse(p);
        }
      }
      return;
    }

    const contentArr = (event.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(contentArr)) return;
    ingestContentParts(eventType, contentArr);
  }

  function finalize(): ParsedTimeline {
    for (const t of thoughts) {
      if (t.status === "streaming") t.status = "completed";
    }
    return { messages, toolCalls, thoughts };
  }

  return {
    ingestJsonlEntry,
    ingestLiveEvent,
    ingestContentParts,
    finalize,
    get messages() {
      return messages;
    },
    get toolCalls() {
      return toolCalls;
    },
    get thoughts() {
      return thoughts;
    },
  };
}

export function parseJsonlEntriesToTimeline(
  entries: Record<string, unknown>[],
  sessionId: string,
  baseTimestamp: number,
): ParsedTimeline {
  const builder = createTimelineBuilder(sessionId, baseTimestamp);
  for (const entry of entries) builder.ingestJsonlEntry(entry);
  return builder.finalize();
}

export function parseLiveEventsToTimeline(
  events: Record<string, unknown>[],
  sessionId: string,
  baseTimestamp = Date.now() - 60_000,
): ParsedTimeline {
  const partialMode = detectPartialAssistantStream(events);
  const builder = createTimelineBuilder(sessionId, baseTimestamp);
  for (const event of events) builder.ingestLiveEvent(event, partialMode);
  return builder.finalize();
}
