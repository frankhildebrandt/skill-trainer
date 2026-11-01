import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyFileEdits, loadSkillBundle, resolveSkillRoot, sameBundle, sanitizeRelative, withDocument, writeSkillTree } from "./skill-bundle";

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

  it("rewrites the complete skill and deletes obsolete references", () => {
    const files = [{ path: "SKILL.md", text: "# Old skill\n" }, { path: "reference.md", text: "obsolete\n" }];
    const document = "---\nname: new-skill\ndescription: New procedure.\n---\n\n# New skill\n";
    const result = applyFileEdits(files, [
      { op: "write", path: "SKILL.md", content: document },
      { op: "delete", path: "reference.md", content: "" },
      { op: "write", path: "scripts/run.sh", content: "#!/bin/sh\necho ok\n" },
    ], Infinity, { allowSkillDocument: true, maxFileChars: Infinity });
    expect(result.applied).toHaveLength(3);
    expect(result.files.find((file) => file.path === "SKILL.md")?.text).toBe(document);
    expect(result.files.find((file) => file.path === "reference.md")).toBeUndefined();
    expect(result.files.find((file) => file.path === "scripts/run.sh")?.executable).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0]?.text).toBe("# Old skill\n");
  });

  it("never deletes or empties SKILL.md", () => {
    const result = applyFileEdits([{ path: "SKILL.md", text: "# Skill\n" }], [
      { op: "delete", path: "SKILL.md", content: "" },
      { op: "write", path: "SKILL.md", content: " " },
      { op: "replace", path: "SKILL.md", target: "# Skill\n", content: "" },
    ], Infinity, { allowSkillDocument: true });
    expect(result.applied).toHaveLength(0);
    expect(result.files[0]?.text).toBe("# Skill\n");
  });

  it("enforces configurable file-operation length and count budgets", () => {
    const content = "a".repeat(15_000);
    const edit = { op: "write" as const, path: "references/long.md", content };
    expect(applyFileEdits([], [edit], 1).applied).toHaveLength(0);
    const result = applyFileEdits([], [edit, { ...edit, path: "references/extra.md" }], 1, { maxFileChars: 20_000 });
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.files[0]?.text).toContain(content);
  });

  it("preserves replacement characters in scripts literally", () => {
    const result = applyFileEdits([{ path: "scripts/run.sh", text: "echo old\n" }], [
      { op: "replace", path: "scripts/run.sh", target: "old", content: "$& $$ $` $'" },
    ], 1);
    expect(result.files[0]?.text).toBe("echo $& $$ $` $'\n");
  });

  it("applies an unlimited bundle that can be written and loaded again", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-large-"));
    roots.push(root);
    const edits = Array.from({ length: 65 }, (_, index) => ({
      op: "write" as const, path: `references/${index}.md`, content: index === 0 ? "x".repeat(130_000) : `Reference ${index}`,
    }));
    const result = applyFileEdits([{ path: "SKILL.md", text: "# Large skill\n" }], edits, Infinity, { maxFileChars: Infinity });
    await writeSkillTree(root, result.files);
    const loaded = await loadSkillBundle(root);
    expect(loaded.files).toHaveLength(66);
    expect(loaded.files.find((file) => file.path === "references/0.md")?.text).toHaveLength(130_001);
  });

  it("preserves executable script permissions through loading and writing", async () => {
    const root = await makeSkill();
    await fs.chmod(path.join(root, "scripts/run.py"), 0o755);
    const bundle = await loadSkillBundle(root);
    const script = bundle.files.find((file) => file.path === "scripts/run.py");
    expect(script?.executable).toBe(true);
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-mode-"));
    roots.push(dest);
    await writeSkillTree(dest, bundle.files);
    expect((await fs.stat(path.join(dest, "scripts/run.py"))).mode & 0o111).toBe(0o111);
    await writeSkillTree(dest, [{ ...script!, executable: false }]);
    expect((await fs.stat(path.join(dest, "scripts/run.py"))).mode & 0o111).toBe(0);
    expect(sameBundle(bundle.document, bundle.document, bundle.files, bundle.files.map((file) => file.path === script?.path ? { ...file, executable: false } : file))).toBe(false);
  });

  it.each([".", "foo/./bar", "../escape", "foo/../bar", "/tmp/escape", "\\tmp\\escape", "C:\\escape", "C:escape", ".git/config", "nested/.GIT/config", "bad\0path"])("rejects unsafe path %s", (input) => {
    expect(sanitizeRelative(input)).toBeNull();
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

it("skips file operations whose paths collide with files or directories", () => {
  const result = applyFileEdits([{ path: "SKILL.md", text: "# Skill" }], [
    { op: "write", path: "references", content: "reference" },
    { op: "write", path: "references/api.md", content: "cannot be inside a file" },
    { op: "write", path: "SKILL.md/child", content: "cannot be inside SKILL.md" },
  ], Infinity, { allowSkillDocument: true, maxFileChars: Infinity });
  expect(result.applied).toHaveLength(1);
  expect(result.skipped).toHaveLength(2);
  expect(result.skipped.every((item) => item.reason.includes("kollidiert"))).toBe(true);
});
