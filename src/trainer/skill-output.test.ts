import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveSkillOutput } from "./skill-output";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-output-"));
  roots.push(root);
  return root;
}

describe("saveSkillOutput", () => {
  it("creates a full skill with executable scripts without replacing an existing destination", async () => {
    const root = await directory();
    const destination = path.join(root, "new-parent", "skill");
    const input = {
      destination,
      create: true,
      stamp: "now",
      files: [
        { path: "SKILL.md", text: "# Created\n" },
        { path: "scripts/check.sh", text: "#!/bin/sh\nexit 0\n", executable: true },
      ],
    };
    const result = await saveSkillOutput(input);
    expect(result.backupPath).toBeNull();
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Created\n");
    expect((await fs.stat(path.join(destination, "scripts/check.sh"))).mode & 0o111).toBe(0o111);
    await expect(saveSkillOutput(input)).rejects.toThrow(/existiert schon/);
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Created\n");
  });

  it("backs up the full original, removes only deleted managed files and preserves unrelated files", async () => {
    const root = await directory();
    const destination = path.join(root, "skill");
    await fs.mkdir(path.join(destination, "scripts"), { recursive: true });
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
    await fs.writeFile(path.join(destination, "scripts/old.sh"), "old\n");
    await fs.writeFile(path.join(destination, "personal.txt"), "unrelated\n");
    const result = await saveSkillOutput({
      destination,
      create: false,
      stamp: "now",
      originalFiles: [{ path: "SKILL.md" }, { path: "scripts/old.sh" }],
      files: [{ path: "SKILL.md", text: "# After\n" }, { path: "references/new.md", text: "reference\n" }],
    });
    expect(await fs.readFile(path.join(destination, "personal.txt"), "utf8")).toBe("unrelated\n");
    expect(await fs.readFile(path.join(destination, "references/new.md"), "utf8")).toBe("reference\n");
    await expect(fs.stat(path.join(destination, "scripts/old.sh"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(result.backupPath!, "SKILL.md"), "utf8")).toBe("# Before\n");
    expect(await fs.readFile(path.join(result.backupPath!, "scripts/old.sh"), "utf8")).toBe("old\n");
    expect(await fs.readFile(path.join(result.backupPath!, "personal.txt"), "utf8")).toBe("unrelated\n");
  });

  it("leaves the original unchanged if a candidate conflicts with an unrelated directory", async () => {
    const root = await directory();
    const destination = path.join(root, "skill");
    await fs.mkdir(path.join(destination, "references"), { recursive: true });
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
    await fs.writeFile(path.join(destination, "references/user.md"), "keep\n");
    await expect(saveSkillOutput({
      destination,
      create: false,
      stamp: "now",
      originalFiles: [{ path: "SKILL.md", text: "# Before\n" }],
      files: [{ path: "SKILL.md", text: "# After\n" }, { path: "references", text: "conflict" }],
    })).rejects.toThrow(/keine Datei/);
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Before\n");
    expect(await fs.readFile(path.join(destination, "references/user.md"), "utf8")).toBe("keep\n");
    expect((await fs.readdir(root)).sort()).toEqual(["skill"]);
  });

  it("restores the original if committing the staged folder fails", async () => {
    const root = await directory();
    const destination = path.join(root, "skill");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (String(source).includes(".skill-trainer-save-")) throw new Error("commit failed");
      return rename(source, target);
    });
    await expect(saveSkillOutput({
      destination,
      create: false,
      stamp: "now",
      files: [{ path: "SKILL.md", text: "# After\n" }],
    })).rejects.toThrow("commit failed");
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Before\n");
    expect(await fs.readdir(root)).toEqual(["skill"]);
  });

  it("does not overwrite an unrelated file added after the skill was loaded", async () => {
    const root = await directory();
    const destination = path.join(root, "skill");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
    await fs.writeFile(path.join(destination, "user.md"), "user's new file\n");
    await expect(saveSkillOutput({
      destination,
      create: false,
      stamp: "now",
      originalFiles: [{ path: "SKILL.md", text: "# Before\n" }],
      files: [{ path: "SKILL.md", text: "# After\n" }, { path: "user.md", text: "generated" }],
    })).rejects.toThrow(/andere Datei/);
    expect(await fs.readFile(path.join(destination, "user.md"), "utf8")).toBe("user's new file\n");
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Before\n");
  });

  it("refuses root and companion symlinks while leaving the external target intact", async () => {
    const root = await directory();
    const destination = path.join(root, "skill");
    const outside = path.join(root, "outside");
    await fs.mkdir(destination);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
    await fs.writeFile(path.join(outside, "notes.md"), "outside\n");
    await fs.symlink(outside, path.join(destination, "references"));
    const input = {
      destination,
      create: false,
      stamp: "now",
      files: [{ path: "SKILL.md", text: "# After\n" }, { path: "references/notes.md", text: "overwrite" }],
    };
    await expect(saveSkillOutput(input)).rejects.toThrow(/Links/);
    expect(await fs.readFile(path.join(outside, "notes.md"), "utf8")).toBe("outside\n");
    const linked = path.join(root, "linked");
    await fs.symlink(destination, linked);
    await expect(saveSkillOutput({ ...input, destination: linked })).rejects.toThrow(/Link/);
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Before\n");
  });

  it("rejects invalid bundles before creating a destination or touching a backup", async () => {
    const root = await directory();
    for (const files of [
      [{ path: "reference.md", text: "missing document" }],
      [{ path: "SKILL.md", text: "# Skill" }, { path: "../escape.md", text: "escape" }],
      [{ path: "SKILL.md", text: "# Skill" }, { path: "SKILL.md", text: "duplicate" }],
    ]) {
      await expect(saveSkillOutput({ destination: path.join(root, "skill"), files, create: true, stamp: "now" })).rejects.toThrow();
    }
    expect(await fs.readdir(root)).toEqual([]);
  });
});

it("can replace an emptied managed directory with a companion file", async () => {
  const root = await directory();
  const destination = path.join(root, "skill");
  await fs.mkdir(path.join(destination, "refs"), { recursive: true });
  await fs.writeFile(path.join(destination, "SKILL.md"), "# Before\n");
  await fs.writeFile(path.join(destination, "refs/old.md"), "old");
  await saveSkillOutput({ destination, create: false, stamp: "now", originalFiles: [{ path: "SKILL.md" }, { path: "refs/old.md" }], files: [{ path: "SKILL.md", text: "# After\n" }, { path: "refs", text: "new reference" }] });
  expect(await fs.readFile(path.join(destination, "refs"), "utf8")).toBe("new reference");
});
