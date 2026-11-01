import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyRepo, pinChecks } from "./isolate";
import { assertChecks, harvestChecks, plantChecks, CHECK_COMMAND } from "./checks";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("checks", () => {
  it("reads the authored script and replants it over a weakened copy", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "checks-"));
    roots.push(root);
    const dir = path.join(root, ".skill-trainer", "checks");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "run.sh"), "#!/bin/sh\nexit 1\n");
    await fs.writeFile(path.join(dir, "note.txt"), "look for the module\n");
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "app.ts"), "export {}\n");

    const files = await harvestChecks(root);
    expect(files.map((file) => file.path)).toEqual([
      ".skill-trainer/checks/note.txt",
      ".skill-trainer/checks/run.sh",
    ]);

    await fs.writeFile(path.join(dir, "run.sh"), "exit 0\n");
    await fs.writeFile(path.join(dir, "cheat.sh"), "echo hi\n");
    await plantChecks(root, files);

    expect(await fs.readFile(path.join(dir, "run.sh"), "utf8")).toBe("#!/bin/sh\nexit 1\n");
    await expect(fs.stat(path.join(dir, "cheat.sh"))).rejects.toThrow();
    expect(CHECK_COMMAND).toBe("sh .skill-trainer/checks/run.sh");
  });

  it("rejects a script that leaves the checks directory", () => {
    expect(() =>
      assertChecks([{ path: ".skill-trainer/checks/../../etc/passwd", text: "exit 1\n" }]),
    ).toThrow(/außerhalb/);
    expect(() => assertChecks([])).toThrow(/run\.sh/);
  });

  it("hides the planted script from the agent diff", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "checks-pin-"));
    roots.push(root);
    const iso = await createEmptyRepo(path.join(root, "repo"));
    await plantChecks(iso.dir, [{ path: ".skill-trainer/checks/run.sh", text: "exit 1\n" }]);
    await pinChecks(iso);
    await fs.writeFile(path.join(iso.dir, "made.txt"), "from the agent\n");
    const diff = await iso.diff();
    expect(diff.stat).toContain("made.txt");
    expect(diff.stat).not.toContain("run.sh");
  });
});
