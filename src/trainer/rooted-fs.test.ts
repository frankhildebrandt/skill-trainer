import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rootedFs } from "./rooted-fs";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("rootedFs", () => {
  it("reads and writes inside the workspace and refuses a path outside it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-fs-"));
    dirs.push(dir);
    const outside = path.join(path.dirname(dir), `secret-${path.basename(dir)}.txt`);
    await fs.writeFile(outside, "nope");
    dirs.push(outside);
    const tree = rootedFs(dir);
    await tree.write("/src/main.go", "package main\n");
    expect(await tree.read("/src/main.go")).toBe("package main\n");
    expect(await tree.stat("/src")).toEqual({ kind: "directory" });
    await expect(tree.read("/../secret.txt")).rejects.toThrow(/not found/);
    expect(await fs.readFile(outside, "utf8")).toBe("nope");
    const listed: string[] = [];
    for await (const entry of tree.list("/")) listed.push(entry.path);
    expect(listed).toEqual(["/src/main.go"]);
  });
});
