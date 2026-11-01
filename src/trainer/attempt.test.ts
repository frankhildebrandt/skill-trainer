import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placeSkill } from "./attempt";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function directory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-placement-"));
  roots.push(root);
  return root;
}
const files = [{ path: "SKILL.md", text: "---\nname: helper\n---\nRun the new script.\n" }];

describe("placing the current skill bundle", () => {
  it("removes obsolete copied companions from both the original location and Cursor mirror", async () => {
    const dest = await directory();
    for (const relative of ["skills/helper", ".cursor/skills/helper"]) {
      await fs.mkdir(path.join(dest, relative), { recursive: true });
      await fs.writeFile(path.join(dest, relative, "obsolete.md"), "old version");
    }
    await placeSkill(dest, files, "/project", "/project/skills/helper");
    for (const relative of ["skills/helper", ".cursor/skills/helper"]) {
      await expect(fs.stat(path.join(dest, relative, "obsolete.md"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(dest, relative, "SKILL.md"), "utf8")).toBe(files[0].text);
    }
  });

  it("refuses copied symlink paths before removing anything outside the run", async () => {
    const dest = await directory();
    const outside = await directory();
    await fs.mkdir(path.join(outside, "skills/helper"), { recursive: true });
    await fs.writeFile(path.join(outside, "skills/helper/keep.md"), "keep");
    await fs.symlink(outside, path.join(dest, ".cursor"));
    await expect(placeSkill(dest, files, "/project", "/external-skill")).rejects.toThrow(/symbolischen Links/);
    expect(await fs.readFile(path.join(outside, "skills/helper/keep.md"), "utf8")).toBe("keep");
  });
});
