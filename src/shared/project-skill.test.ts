import { describe, expect, it } from "vitest";
import { matchesSkill, skillPathForWorkspace } from "./project-skill";

describe("skillPathForWorkspace", () => {
  const skills = [{ root: "/repo/.cursor/skills/alpha" }, { root: "/repo/skills/beta" }];

  it("keeps a skill that already belongs to the selected project", () => {
    expect(skillPathForWorkspace("/repo/skills/beta/SKILL.md", "/old", skills)).toBe("/repo/skills/beta");
    expect(matchesSkill("/repo/skills/beta/", "/repo/skills/beta")).toBe(true);
  });

  it("selects the only skill when the previous one lived in the old project", () => {
    expect(skillPathForWorkspace("/old/.cursor/skills/one", "/old", [{ root: "/repo/.cursor/skills/alpha" }])).toBe(
      "/repo/.cursor/skills/alpha",
    );
  });

  it("clears a previous project skill when the new project has several", () => {
    expect(skillPathForWorkspace("/old/.cursor/skills/one", "/old", skills)).toBe("");
  });

  it("keeps a skill that lives outside the previous project", () => {
    expect(skillPathForWorkspace("/home/skills/custom", "/old", skills)).toBe("/home/skills/custom");
  });
});
