import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUserMessageContent } from "./message-display.ts";

describe("parseUserMessageContent", () => {
  it("returns plain text unchanged", () => {
    const r = parseUserMessageContent("hello world");
    assert.deepEqual(r, { skills: [], text: "hello world", hadSkillDump: false });
  });

  it("parses short [Skills:] prefix", () => {
    const r = parseUserMessageContent("[Skills: frontend-design,foo]\n\nPlease fix the sidebar");
    assert.deepEqual(r.skills, ["frontend-design", "foo"]);
    assert.equal(r.text, "Please fix the sidebar");
    assert.equal(r.hadSkillDump, false);
  });

  it("collapses full skill dump to chips + user text", () => {
    const content = [
      "The user explicitly invoked the following Agent Skill(s). Follow them carefully for this turn.",
      "",
      "### Skill: /frontend-design",
      "",
      "# Frontend Design",
      "Lots of skill body here...",
      "",
      "### Skill: /other",
      "",
      "more body",
      "",
      "---",
      "",
      "melhore o sidebar",
    ].join("\n");

    const r = parseUserMessageContent(content);
    assert.deepEqual(r.skills, ["frontend-design", "other"]);
    assert.equal(r.text, "melhore o sidebar");
    assert.equal(r.hadSkillDump, true);
  });
});
