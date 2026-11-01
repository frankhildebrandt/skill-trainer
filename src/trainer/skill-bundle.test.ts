import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyFileEdits, loadSkillBundle, resolveSkillRoot, withDocument, writeSkillTree } from "./skill-bundle";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("skill folder", () => {
  it("loads SKILL.md together with scripts and extra documents", async () => {
    const root = await makeSkill();
    const fromFile = await resolveSkillRoot(path.join(root, "SKILL.md"));
    const fromDir = await resolveSkillRoot(root);
    expect(fromFile).toBe(root);
    expect(fromDir).toBe(root);
    const bundle = await loadSkillBundle(path.join(root, "scripts", "run.py"));
    expect(bundle.files.map((file) => file.path).sort()).toEqual(["SKILL.md", "reference.md", "scripts/run.py"]);
    expect(bundle.files.find((file) => file.path === "scripts/run.py")?.text).toContain("def run");
  });

  it("writes the whole folder and keeps an edited SKILL.md", async () => {
    const root = await makeSkill();
    const bundle = await loadSkillBundle(root);
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-place-"));
    roots.push(dest);
    const files = withDocument(bundle.files, "---\nname: demo\n---\n\nUse the script.\n");
    await writeSkillTree(path.join(dest, "skill"), files);
    expect(await fs.readFile(path.join(dest, "skill", "SKILL.md"), "utf8")).toContain("Use the script.");
    expect(await fs.readFile(path.join(dest, "skill", "scripts", "run.py"), "utf8")).toContain("def run");
    expect(await fs.readFile(path.join(dest, "skill", "reference.md"), "utf8")).toContain("flags");
  });

  it("edits a helper file and refuses to retarget SKILL.md or a parent path", () => {
    const files = [
      { path: "SKILL.md", text: "# Skill\n" },
      { path: "scripts/run.py", text: "print('old')\n" },
    ];
    const result = applyFileEdits(
      files,
      [
        { op: "replace", path: "scripts/run.py", target: "print('old')", content: "print('new')" },
        { op: "write", path: "SKILL.md", content: "nope" },
        { op: "write", path: "../outside.py", content: "nope" },
      ],
      3,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.files.find((file) => file.path === "scripts/run.py")?.text).toContain("print('new')");
    expect(result.skipped.map((item) => item.reason).join(" ")).toMatch(/SKILL.md/);
    expect(result.skipped.map((item) => item.reason).join(" ")).toMatch(/ungültig/);
  });
});

async function makeSkill(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-skill-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "scripts"));
  await fs.writeFile(path.join(root, "SKILL.md"), "---\nname: demo\n---\n\n# Demo\n\nRun scripts/run.py.\n");
  await fs.writeFile(path.join(root, "reference.md"), "flags: --fast\n");
  await fs.writeFile(path.join(root, "scripts", "run.py"), "def run():\n    return 1\n");
  return root;
}
