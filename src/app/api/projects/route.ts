import { sep } from "path";
import { listProjects } from "@/lib/transcript-reader";
import { listWorkspaces } from "@/lib/session-store";
import { getWorkspace } from "@/lib/workspace";
import { serverError } from "@/lib/errors";
import type { ProjectInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [transcriptProjects, dbWorkspaces] = await Promise.all([
      listProjects(),
      listWorkspaces(),
    ]);
    const currentWorkspace = getWorkspace();

    const byPath = new Map<string, ProjectInfo>();
    for (const p of transcriptProjects) {
      byPath.set(p.path, p);
    }
    for (const ws of dbWorkspaces) {
      if (byPath.has(ws)) continue;
      const name = ws.split(/[/\\]/).pop() || ws;
      byPath.set(ws, { name, path: ws, key: ws });
    }
    if (!byPath.has(currentWorkspace)) {
      const name = currentWorkspace.split(/[/\\]/).pop() || currentWorkspace;
      byPath.set(currentWorkspace, { name, path: currentWorkspace, key: currentWorkspace });
    }

    const projects = Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ projects, currentWorkspace });
  } catch {
    return serverError("Failed to list projects");
  }
}
