import { getConfig, getSessionTitle } from "@/lib/session-store";
import { readSessionMessages } from "@/lib/transcript-reader";
import { getNetworkInfo } from "@/lib/network";
import { DEFAULT_PORT } from "@/lib/constants";
import type { TodoItem } from "@/lib/types";

export async function getWebhookUrl(): Promise<string> {
  return (await getConfig("webhook_url")) || "";
}

interface WebhookPayload {
  event: string;
  title: string;
  message: string;
  url?: string;
  sessionId?: string;
  workspace?: string;
  timestamp: number;
}

function isDiscord(url: string): boolean {
  return url.includes("discord.com/api/webhooks");
}

function isSlack(url: string): boolean {
  return url.includes("hooks.slack.com");
}

function todoStatusIcon(status: string): string {
  if (status.includes("COMPLETED")) return "\u2705";
  if (status.includes("PROGRESS")) return "\u23f3";
  return "\u2B1C";
}

function formatTodoList(todos: TodoItem[]): string {
  return todos.map((t) => `${todoStatusIcon(t.status)} ${t.content}`).join("\n");
}

function formatForDiscord(payload: WebhookPayload): Record<string, unknown> {
  const color = payload.event === "test" ? 0x5865f2 : 0x57f287;
  const parts = [payload.message];
  if (payload.url) parts.push(`\n[Abrir no CLR](${payload.url})`);
  return {
    embeds: [{
      title: payload.title,
      description: parts.join("\n"),
      color,
      timestamp: new Date(payload.timestamp).toISOString(),
    }],
  };
}

function formatForSlack(payload: WebhookPayload): Record<string, unknown> {
  const link = payload.url ? `\n<${payload.url}|Abrir no CLR>` : "";
  return { text: `*${payload.title}*\n${payload.message}${link}` };
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  if (!url) return;

  let body: Record<string, unknown>;
  if (isDiscord(url)) {
    body = formatForDiscord(payload);
  } else if (isSlack(url)) {
    body = formatForSlack(payload);
  } else {
    body = { ...payload };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status}`);
  }
}

function buildSessionUrl(sessionId: string, workspace?: string): string | undefined {
  try {
    const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
    const info = getNetworkInfo(port);
    const token = process.env.AUTH_TOKEN;
    const base = token ? `${info.url}?token=${token}` : info.url;
    const hash = workspace
      ? `#session=${sessionId}&workspace=${encodeURIComponent(workspace)}`
      : `#session=${sessionId}`;
    return `${base}${hash}`;
  } catch {
    return undefined;
  }
}

async function getLatestTodos(workspace: string, sessionId: string): Promise<TodoItem[]> {
  try {
    const { toolCalls } = await readSessionMessages(workspace, sessionId);
    const todoCall = [...toolCalls].reverse().find((tc) => tc.type === "todo" && tc.todos?.length);
    return todoCall?.todos ?? [];
  } catch {
    return [];
  }
}

export async function notifyAgentComplete(sessionId: string, workspace: string): Promise<void> {
  try {
    const url = await getWebhookUrl();
    if (!url) return;

    const project = workspace.split("/").filter(Boolean).pop() || workspace;
    const prompt = await getSessionTitle(sessionId);
    const todos = await getLatestTodos(workspace, sessionId);

    const parts: string[] = [];
    if (prompt) parts.push(`"${prompt}"`);
    if (todos.length > 0) {
      parts.push(formatTodoList(todos));
    }
    if (parts.length === 0) {
      parts.push(`Sessão ${sessionId.slice(0, 8)} concluída`);
    }

    await sendWebhook(url, {
      event: "agent_complete",
      title: `Concluído - ${project}`,
      message: parts.join("\n\n"),
      url: buildSessionUrl(sessionId, workspace),
      sessionId,
      workspace,
      timestamp: Date.now(),
    });
  } catch {
    // fire-and-forget
  }
}
