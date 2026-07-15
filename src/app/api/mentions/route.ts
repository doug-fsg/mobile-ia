import { searchMentions } from "@/lib/mentions";
import { searchSkills } from "@/lib/skills";
import { getWorkspace } from "@/lib/workspace";
import { serverError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    const workspace = url.searchParams.get("workspace") || getWorkspace();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "40", 10) || 40, 80);

    const fileHits = searchMentions(workspace, q, Math.ceil(limit * 0.7));
    const skillHits = searchSkills(q, workspace, Math.ceil(limit * 0.3)).map((s) => ({
      id: `skill:${s.name}`,
      kind: "skill" as const,
      label: s.name,
      detail: s.description?.slice(0, 80) || "Skill",
      insert: `/${s.name}`,
      path: s.path,
    }));

    return Response.json({
      items: [...skillHits, ...fileHits].slice(0, limit),
    });
  } catch {
    return serverError("Failed to list mentions");
  }
}
