import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProjectSkills } from "./project-skills";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("listProjectSkills", () => {
  it("finds project skills and skips dependencies and symlink escapes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-skills-"));
    roots.push(root);
    const project = path.join(root, "project");
    await writeSkill(path.join(project, ".cursor", "skills", "alpha"), "alpha-skill", "Alpha procedure.");
    await writeSkill(path.join(project, "skills", "beta"), "beta-skill", "Beta procedure.");
    await writeSkill(path.join(project, "node_modules", "pkg"), "hidden", "Dependency.");
    await fs.mkdir(path.join(project, "docs"), { recursive: true });
    await fs.writeFile(path.join(project, "docs", "notes.md"), "not a skill");
    const outside = path.join(root, "outside");
    await writeSkill(outside, "outside", "Outside.");
    await fs.symlink(outside, path.join(project, "linked"));

    const skills = await listProjectSkills(project);
    expect(skills.map((skill) => skill.name)).toEqual(["alpha-skill", "beta-skill"]);
    expect(skills.map((skill) => skill.relative)).toEqual([".cursor/skills/alpha", path.join("skills", "beta")]);
  });

  it("includes a repository whose root is the skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-root-skill-"));
    roots.push(root);
    await writeSkill(root, "root-skill", "The project is the skill.");
    const skills = await listProjectSkills(root);
    expect(skills).toEqual([{ root: await fs.realpath(root), relative: ".", name: "root-skill" }]);
  });
});

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}
