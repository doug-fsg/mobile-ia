import { readSessionMessages, getSessionModifiedAt } from "@/lib/transcript-reader";
import { getWorkspace } from "@/lib/workspace";
import { sessionIdParam } from "@/lib/validation";
import { badRequest } from "@/lib/errors";
import { vlog } from "@/lib/verbose";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const rawId = url.searchParams.get("id");
  const checkOnly = url.searchParams.get("check") === "true";
  const sinceParam = url.searchParams.get("since");

  vlog("history", "GET request", { rawId, checkOnly, sinceParam });

  const result = sessionIdParam.safeParse(rawId);
  if (!result.success) {
    vlog("history", "invalid session id", rawId);
    return badRequest("invalid or missing session id");
  }
  const sessionId = result.data;

  const workspace = url.searchParams.get("workspace") || getWorkspace();
  vlog("history", "resolved workspace", workspace, "sessionId", sessionId);

  if (checkOnly) {
    const modifiedAt = await getSessionModifiedAt(workspace, sessionId);
    vlog("history", "checkOnly result", { sessionId, modifiedAt, ms: Date.now() - t0 });
    return Response.json({ sessionId, modifiedAt });
  }

  if (sinceParam) {
    const since = parseInt(sinceParam, 10);
    const modifiedAt = await getSessionModifiedAt(workspace, sessionId);
    if (!isNaN(since) && modifiedAt <= since) {
      vlog("history", "not modified since", since, "modifiedAt", modifiedAt, `${Date.now() - t0}ms`);
      return Response.json({ sessionId, modifiedAt, messages: null, toolCalls: null });
    }
  }

  const { messages, toolCalls, thoughts, modifiedAt } = await readSessionMessages(workspace, sessionId);
  vlog("history", "loaded", { sessionId, messages: messages.length, toolCalls: toolCalls.length, thoughts: thoughts.length, modifiedAt, ms: Date.now() - t0 });
  return Response.json({ messages, toolCalls, thoughts, sessionId, modifiedAt });
}
