import { listSessions, deleteSession, archiveSession, unarchiveSession, archiveAllSessions, getArchivedSessionIds, getDeletedSessionIds } from "@/lib/session-store";
import { readCursorSessions } from "@/lib/transcript-reader";
import { getWorkspace } from "@/lib/workspace";
import { deleteSessionSchema, parseBody } from "@/lib/validation";
import { badRequest, parseJsonBody, serverError } from "@/lib/errors";
import { vlog } from "@/lib/verbose";
import type { StoredSession } from "@/lib/types";

export const dynamic = "force-dynamic";

function mergeSessions(ours: StoredSession[], cursor: StoredSession[]): StoredSession[] {
  const byId = new Map<string, StoredSession>();

  for (const s of cursor) {
    byId.set(s.id, s);
  }
  for (const s of ours) {
    const existing = byId.get(s.id);
    if (existing) {
      byId.set(s.id, {
        ...existing,
        updatedAt: Math.max(existing.updatedAt, s.updatedAt),
      });
    } else {
      byId.set(s.id, s);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "true";
  const workspaceParam = url.searchParams.get("workspace");
  const archived = url.searchParams.get("archived") === "true";
  const workspace = workspaceParam || getWorkspace();

  vlog("sessions", "GET", { all, archived, workspace });

  const deletedIds = await getDeletedSessionIds();

  if (all) {
    const ours = (await listSessions(undefined, archived)).filter((s) => !deletedIds.has(s.id));
    vlog("sessions", "all mode", { count: ours.length, ms: Date.now() - t0 });
    return Response.json({ sessions: ours, workspace });
  }

  const cursorSessions = await readCursorSessions(workspace);
  const ourSessions = await listSessions(workspace, archived);
  vlog("sessions", "fetched", { cursorSessions: cursorSessions.length, ourSessions: ourSessions.length });

  if (archived) {
    const archivedIds = await getArchivedSessionIds();
    const archivedCursorSessions = cursorSessions.filter(
      (s) => archivedIds.has(s.id) && !deletedIds.has(s.id),
    );
    const merged = mergeSessions(ourSessions, archivedCursorSessions).filter(
      (s) => !deletedIds.has(s.id),
    );
    vlog("sessions", "archived result", { merged: merged.length, ms: Date.now() - t0 });
    return Response.json({ sessions: merged, workspace });
  }

  const archivedIds = await getArchivedSessionIds();
  const activeCursorSessions = cursorSessions.filter(
    (s) => !archivedIds.has(s.id) && !deletedIds.has(s.id),
  );
  const merged = mergeSessions(ourSessions, activeCursorSessions).filter(
    (s) => !deletedIds.has(s.id),
  );
  vlog("sessions", "result", {
    merged: merged.length,
    archivedIds: archivedIds.size,
    deletedIds: deletedIds.size,
    ms: Date.now() - t0,
  });

  return Response.json({ sessions: merged, workspace });
}

export async function DELETE(req: Request) {
  const raw = await parseJsonBody<{ sessionId?: string; workspace?: string }>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(deleteSessionSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);

  const sessionId = parsed.data.sessionId;
  const workspace = typeof raw.workspace === "string" ? raw.workspace : getWorkspace();

  // Prefer metadata from Cursor transcripts so tombstones work for sessions
  // that were never stored in our SQLite DB.
  let meta: StoredSession | undefined;
  try {
    const cursorSessions = await readCursorSessions(workspace);
    meta = cursorSessions.find((s) => s.id === sessionId);
  } catch {
    // fall through with minimal tombstone
  }

  await deleteSession(sessionId, meta ?? { id: sessionId, title: "Deleted", workspace, preview: "", createdAt: Date.now(), updatedAt: Date.now() });
  return Response.json({ ok: true });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { action: string; sessionId?: string; workspace?: string };
    const { action, sessionId, workspace } = body;

    switch (action) {
      case "archive": {
        if (!sessionId) return badRequest("sessionId required");
        const ws = workspace || getWorkspace();
        const cursorSessions = ws ? await readCursorSessions(ws) : [];
        const cursorSession = cursorSessions.find((s) => s.id === sessionId);
        await archiveSession(sessionId, cursorSession);
        break;
      }
      case "unarchive": {
        if (!sessionId) return badRequest("sessionId required");
        await unarchiveSession(sessionId);
        break;
      }
      case "archive_all": {
        const ws = workspace || getWorkspace();
        const cursorSessions = ws ? await readCursorSessions(ws) : [];
        await archiveAllSessions(workspace, cursorSessions);
        break;
      }
      default:
        return badRequest("Invalid action");
    }

    return Response.json({ ok: true });
  } catch {
    return serverError("Failed to update session");
  }
}
