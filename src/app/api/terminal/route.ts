import { spawnTerminal, listTerminals, killTerminal, removeTerminal, signalTerminal } from "@/lib/terminal-registry";
import { getWorkspace } from "@/lib/workspace";
import { resolveExistingDir } from "@/lib/paths";
import { badRequest, serverError, parseJsonBody } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ terminals: listTerminals() });
}

export async function POST(req: Request) {
  const body = await parseJsonBody<{ cwd?: string }>(req);
  if (body instanceof Response) return body;

  const cwd = body.cwd ? resolveExistingDir(body.cwd) : getWorkspace();
  if (!cwd) return badRequest("invalid cwd");

  try {
    const term = spawnTerminal(cwd);
    return Response.json({ id: term.id, cwd: term.cwd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to spawn terminal";
    return serverError(msg);
  }
}

export async function DELETE(req: Request) {
  const body = await parseJsonBody<{ id?: string; remove?: boolean; signal?: string }>(req);
  if (body instanceof Response) return body;

  if (!body.id) return badRequest("id is required");

  if (body.signal) {
    const ok = signalTerminal(body.id, body.signal as NodeJS.Signals);
    if (!ok) return badRequest("terminal not found or not running");
    return Response.json({ ok: true });
  }

  const ok = body.remove ? removeTerminal(body.id) : killTerminal(body.id);
  if (!ok) return badRequest("terminal not found");
  return Response.json({ ok: true });
}
