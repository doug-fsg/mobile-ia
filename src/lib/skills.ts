import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: "user" | "project" | "plugin";
}

const CACHE_TTL_MS = 60_000;
const MAX_SKILL_BODY_CHARS = 80_000;

const cacheByWorkspace = new Map<string, { at: number; skills: SkillInfo[] }>();

function parseFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = content.slice(3, end);
  const out: { name?: string; description?: string } = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "name") out.name = val;
    if (key === "description") out.description = val;
  }
  return out;
}

function walkSkills(root: string, source: SkillInfo["source"], out: SkillInfo[], depth = 0): void {
  if (depth > 6 || !existsSync(root)) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    const skillFile = join(dir, "SKILL.md");
    if (existsSync(skillFile)) {
      try {
        const raw = readFileSync(skillFile, "utf-8").slice(0, 4000);
        const meta = parseFrontmatter(raw);
        const name = meta.name || entry.name;
        out.push({
          name,
          description: meta.description || "",
          path: skillFile,
          source,
        });
      } catch {
        // skip unreadable
      }
      continue;
    }
    // Category folders (e.g. shipping/deploy) — recurse
    walkSkills(dir, source, out, depth + 1);
  }
}

function skillRoots(workspace?: string): { root: string; source: SkillInfo["source"] }[] {
  const roots: { root: string; source: SkillInfo["source"] }[] = [
    { root: join(homedir(), ".cursor", "skills"), source: "user" },
    { root: join(homedir(), ".agents", "skills"), source: "user" },
  ];
  if (workspace) {
    roots.unshift(
      { root: join(workspace, ".cursor", "skills"), source: "project" },
      { root: join(workspace, ".agents", "skills"), source: "project" },
    );
  }
  return roots;
}

export function listSkills(workspace?: string, force = false): SkillInfo[] {
  const now = Date.now();
  const cacheKey = workspace || "";
  const cached = cacheByWorkspace.get(cacheKey);
  if (!force && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.skills;
  }

  const byName = new Map<string, SkillInfo>();
  for (const { root, source } of skillRoots(workspace)) {
    const found: SkillInfo[] = [];
    walkSkills(root, source, found);
    for (const s of found) {
      // Prefer project skills over user over later duplicates
      const existing = byName.get(s.name);
      if (!existing) {
        byName.set(s.name, s);
      } else if (s.source === "project" && existing.source !== "project") {
        byName.set(s.name, s);
      }
    }
  }

  const skills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  cacheByWorkspace.set(cacheKey, { at: now, skills });
  return skills;
}

export function searchSkills(query: string, workspace?: string, limit = 40): SkillInfo[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  const all = listSkills(workspace);
  if (!q) return all.slice(0, limit);

  const scored: { s: SkillInfo; score: number }[] = [];
  for (const s of all) {
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 50;
    else if (desc.includes(q)) score = 20;
    else continue;
    scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

export function readSkillBody(skillPath: string): string | null {
  try {
    if (basename(skillPath) !== "SKILL.md") return null;
    const normalized = skillPath.replace(/\\/g, "/").toLowerCase();
    const allowed = normalized.includes("/skills/") || normalized.includes("/.agents/skills/");
    if (!allowed || !normalized.endsWith("/skill.md")) return null;
    if (!existsSync(skillPath)) return null;
    const body = readFileSync(skillPath, "utf-8");
    if (body.length > MAX_SKILL_BODY_CHARS) {
      return body.slice(0, MAX_SKILL_BODY_CHARS) + "\n\n[...skill truncated...]";
    }
    return body;
  } catch {
    return null;
  }
}

/** Build prompt prefix that forces the agent to follow selected skills. */
export function buildSkillPromptPrefix(skills: { name: string; path: string }[]): string {
  if (skills.length === 0) return "";
  const parts: string[] = [
    "The user explicitly invoked the following Agent Skill(s). Follow them carefully for this turn.",
    "",
  ];
  for (const s of skills) {
    const body = readSkillBody(s.path);
    if (!body) {
      parts.push(`Skill /${s.name} (file missing at ${s.path})`);
      continue;
    }
    parts.push(`### Skill: /${s.name}`);
    parts.push("");
    parts.push(body);
    parts.push("");
  }
  parts.push("---");
  parts.push("");
  return parts.join("\n");
}
