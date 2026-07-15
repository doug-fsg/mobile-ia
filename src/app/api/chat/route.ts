import { randomUUID } from "node:crypto";
import { spawnAgent } from "@/lib/cursor-cli";
import { getWorkspace } from "@/lib/workspace";
import { resolveExistingDir } from "@/lib/paths";
import { upsertSession } from "@/lib/session-store";
import { registerProcess, promoteToSessionId, pushLiveEvent, setProcessExitHook } from "@/lib/process-registry";
import { chatRequestSchema, parseBody } from "@/lib/validation";
import { badRequest, serverError, safeErrorMessage, parseJsonBody } from "@/lib/errors";
import { AGENT_INIT_TIMEOUT_MS } from "@/lib/constants";
import { notifyAgentComplete } from "@/lib/webhooks";
import { buildSkillPromptPrefix, listSkills } from "@/lib/skills";
import type { ChatRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIVE_EVENT_TYPES = new Set(["user", "assistant", "thinking", "tool_call"]);

setProcessExitHook((sessionId, workspace) => {
  void notifyAgentComplete(sessionId, workspace);
});

function waitForSessionId(
  child: Awaited<ReturnType<typeof spawnAgent>>,
  workspace: string,
  prompt: string,
  requestId: string,
  resumeSessionId?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let found = false;
    let lineBuffer = "";
    let resolvedSessionId: string | null = null;
    const earlyEvents: Record<string, unknown>[] = [];

    const flushEarly = (sessionId: string) => {
      for (const event of earlyEvents) {
        pushLiveEvent(sessionId, event);
      }
      earlyEvents.length = 0;
    };

    const timer = setTimeout(() => {
      if (!found) resolve(null);
    }, AGENT_INIT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          if (!found && event.type === "system" && event.subtype === "init" && event.session_id) {
            found = true;
            const sid = String(event.session_id);
            // Prefer real CLI session id; on resume keep client's if CLI echoes the same.
            resolvedSessionId =
              resumeSessionId && resumeSessionId === sid ? resumeSessionId : sid;
            clearTimeout(timer);
            void upsertSession(resolvedSessionId, workspace, prompt);
            promoteToSessionId(requestId, resolvedSessionId);
            flushEarly(resolvedSessionId);
            resolve(resolvedSessionId);
          }

          if (LIVE_EVENT_TYPES.has(event.type as string)) {
            if (resolvedSessionId) {
              pushLiveEvent(resolvedSessionId, event);
            } else {
              earlyEvents.push(event);
              if (earlyEvents.length > 500) earlyEvents.shift();
            }
          }
        } catch {
          // non-json line
        }
      }
    });

    child.on("close", () => {
      if (!found) {
        clearTimeout(timer);
        resolve(null);
      }
    });

    child.on("error", () => {
      if (!found) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

export async function POST(req: Request) {
  const raw = await parseJsonBody<ChatRequest>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(chatRequestSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);
  const body = parsed.data;

  let workspace: string;
  if (body.workspace) {
    const resolved = resolveExistingDir(body.workspace);
    if (!resolved) return badRequest("invalid workspace path");
    workspace = resolved;
  } else {
    workspace = getWorkspace();
  }

  try {
    const requestId = randomUUID();

    // Expand skills server-side so the chat UI stays clean (chips only).
    let agentPrompt = body.prompt;
    if (body.skills && body.skills.length > 0) {
      const all = listSkills(workspace);
      const resolved = body.skills
        .map((name) => all.find((s) => s.name === name))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ name: s.name, path: s.path }));
      const prefix = buildSkillPromptPrefix(resolved);
      if (prefix) agentPrompt = prefix + body.prompt;
    }

    const child = await spawnAgent({
      prompt: agentPrompt,
      sessionId: body.sessionId,
      workspace,
      model: body.model,
      mode: body.mode,
      worktree: body.worktree,
    });

    registerProcess(requestId, child, workspace);

    // Do not promote to resume id until CLI confirms init — avoids orphan map keys.
    // (waitForSessionId promotes once with the real session_id.)

    const verbose = process.env.CLR_VERBOSE === "1";

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error("[agent stderr]", text);
    });

    if (verbose) {
      console.warn(
        `[chat] spawning agent in ${workspace} (model=${body.model ?? "default"}, mode=${body.mode ?? "agent"}, worktree=${body.worktree && !body.sessionId ? "yes" : "no"}, skills=${body.skills?.length ?? 0})`,
      );
    }

    // Title/preview from the clean user prompt, never the skill dump.
    const sessionId = await waitForSessionId(
      child,
      workspace,
      body.prompt,
      requestId,
      body.sessionId,
    );

    if (!sessionId) {
      child.kill("SIGTERM");
      console.error("[chat] agent did not emit init event within timeout");
      return serverError("Agent failed to start");
    }

    if (verbose) {
      console.warn(`[chat] agent started session ${sessionId}`);
    }

    return Response.json({ sessionId });
  } catch (err) {
    safeErrorMessage(err, "Failed to start agent");
    return serverError("Failed to start agent");
  }
}
