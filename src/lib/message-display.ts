/** Detect and collapse skill bodies that were inlined into user prompts. */

const SKILL_DUMP_HEADER =
  /^The user explicitly invoked the following Agent Skill\(s\)\. Follow them carefully for this turn\.\s*/i;

const SKILL_NAME_RE = /###\s*Skill:\s*\/([^\s\n]+)/gi;
const SHORT_SKILLS_RE = /^\[Skills:\s*([^\]]+)\]\s*/i;

export interface ParsedUserMessage {
  skills: string[];
  text: string;
  hadSkillDump: boolean;
}

/**
 * Split a user message into skill chips + visible text.
 * Handles both the full SKILL.md dump and the short `[Skills: a,b]` prefix.
 */
export function parseUserMessageContent(content: string): ParsedUserMessage {
  if (!content) return { skills: [], text: "", hadSkillDump: false };

  const short = content.match(SHORT_SKILLS_RE);
  if (short) {
    const skills = short[1]
      .split(",")
      .map((s) => s.trim().replace(/^\//, ""))
      .filter(Boolean);
    return {
      skills,
      text: content.slice(short[0].length).trimStart(),
      hadSkillDump: false,
    };
  }

  if (!SKILL_DUMP_HEADER.test(content)) {
    return { skills: [], text: content, hadSkillDump: false };
  }

  const skills: string[] = [];
  let m: RegExpExecArray | null;
  SKILL_NAME_RE.lastIndex = 0;
  while ((m = SKILL_NAME_RE.exec(content)) !== null) {
    if (m[1] && !skills.includes(m[1])) skills.push(m[1]);
  }

  // Prefer last horizontal rule separator before the real user text
  const sepIdx = content.lastIndexOf("\n---\n");
  let text = content;
  if (sepIdx >= 0) {
    text = content.slice(sepIdx + 5).trimStart();
  } else {
    // Fallback: strip header through last skill block start
    text = content.replace(SKILL_DUMP_HEADER, "");
    const lastSkill = text.lastIndexOf("### Skill:");
    if (lastSkill >= 0) {
      const after = text.slice(lastSkill);
      const bodyEnd = after.search(/\n\n(?!#)/);
      text = bodyEnd >= 0 ? after.slice(bodyEnd).trimStart() : "";
    }
  }

  return { skills, text, hadSkillDump: true };
}

/** Build a short display prefix (not for the agent — use server-side expansion). */
export function formatSkillsPrefix(skillNames: string[]): string {
  if (skillNames.length === 0) return "";
  return `[Skills: ${skillNames.join(",")}]`;
}
