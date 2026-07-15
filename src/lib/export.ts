import type { ChatMessage, ToolCallInfo } from "@/lib/types";
import { parseUserMessageContent } from "@/lib/message-display";

function toolCallLine(tc: ToolCallInfo): string {
  const label = tc.type === "shell" ? "Shell" : tc.type === "search" ? "Search" : tc.type === "edit" ? "Edit" : tc.type === "write" ? "Write" : tc.type === "read" ? "Read" : tc.name;
  const target = tc.type === "shell" ? tc.command : tc.path;
  return target ? `> **${label}** \`${target}\`` : `> **${label}**`;
}

export function exportSessionMarkdown(messages: ChatMessage[], toolCalls: ToolCallInfo[]): string {
  const items = [
    ...messages.map((m) => ({ ts: m.timestamp, kind: "msg" as const, msg: m })),
    ...toolCalls.map((tc) => ({ ts: tc.timestamp, kind: "tc" as const, tc })),
  ].sort((a, b) => a.ts - b.ts);

  const parts: string[] = [];

  for (const item of items) {
    if (item.kind === "msg" && item.msg) {
      const role = item.msg.role === "user" ? "Você" : "Assistente";
      let body = item.msg.content;
      if (item.msg.role === "user") {
        const parsed = parseUserMessageContent(body);
        const skills =
          item.msg.skills?.length ? item.msg.skills : parsed.skills;
        const chips = skills.length
          ? skills.map((s) => `\`/${s}\``).join(" ") + "\n\n"
          : "";
        body = chips + (parsed.text || body);
      }
      parts.push(`## ${role}\n\n${body}`);
    } else if (item.kind === "tc" && item.tc) {
      parts.push(toolCallLine(item.tc));
    }
  }

  return parts.join("\n\n");
}
