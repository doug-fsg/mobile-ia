export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface TodoItem {
  id: string;
  content: string;
  status: string;
}

export interface ToolCallInfo {
  id: string;
  callId: string;
  type: "read" | "write" | "edit" | "shell" | "search" | "todo" | "other";
  name: string;
  path?: string;
  command?: string;
  args?: string;
  status: "running" | "completed" | "error";
  result?: string;
  diff?: string;
  diffStartLine?: number;
  todos?: TodoItem[];
  timestamp: number;
}

export interface ThoughtInfo {
  id: string;
  content: string;
  status: "streaming" | "completed";
  timestamp: number;
}

export interface StoredSession {
  id: string;
  title: string;
  workspace: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentMode = "agent" | "ask" | "plan";

export interface ChatRequest {
  prompt: string;
  sessionId?: string;
  model?: string;
  mode?: AgentMode;
  workspace?: string;
  /** Start new sessions in an isolated git worktree (ignored when resuming). */
  worktree?: boolean;
}

export interface NetworkInfo {
  lanIp: string;
  port: number;
  url: string;
  authUrl: string;
  workspace: string;
}

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  model?: string;
  mode?: AgentMode;
}

export interface ModelInfo {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

export interface ProjectInfo {
  name: string;
  path: string;
  key: string;
}
