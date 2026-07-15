import { searchSkills, readSkillBody, listSkills } from "@/lib/skills";
import { getWorkspace } from "@/lib/workspace";
import { badRequest, serverError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    const workspace = url.searchParams.get("workspace") || getWorkspace();
    const name = url.searchParams.get("name");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "40", 10) || 40, 100);

    if (name) {
      const all = listSkills(workspace);
      const skill = all.find((s) => s.name === name);
      if (!skill) return badRequest("skill not found");
      const body = readSkillBody(skill.path);
      return Response.json({ skill: { ...skill, body } });
    }

    const skills = searchSkills(q, workspace, limit);
    return Response.json({
      skills: skills.map(({ name, description, path, source }) => ({
        name,
        description,
        path,
        source,
      })),
      total: listSkills(workspace).length,
    });
  } catch {
    return serverError("Failed to list skills");
  }
}
