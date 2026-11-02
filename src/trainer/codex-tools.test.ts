import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexFileTools } from "./codex-tools";
import { rootedFs } from "./rooted-fs";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-files-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("Codex file tools", () => {
  it("provides reads and writes inside an empty gate without shell execution", async () => {
    const tools = codexFileTools(rootedFs(root), false, root);
    expect(tools.specs.map((tool) => tool.name)).not.toContain("shell");
    expect((await tools.call("skill_trainer_write_file", { path: "src/answer.ts", content: "export const answer = 42;" })).success).toBe(true);
    expect((await tools.call("skill_trainer_read_file", { path: "/src/answer.ts" })).contentItems[0]?.text).toContain("42");
    expect(tools.sawRead).toBe(true);
    expect((await tools.call("skill_trainer_delete_file", { path: "src/answer.ts" })).success).toBe(true);
  });

  it("exposes only read operations for draft inspection and observes real reads", async () => {
    const tools = codexFileTools(rootedFs(root), true, root);
    await fs.writeFile(path.join(root, "README.md"), "The repository.");
    await tools.call("skill_trainer_list_files", {});
    expect(tools.sawRead).toBe(false);
    expect((await tools.call("skill_trainer_write_file", { path: "README.md", content: "changed" })).success).toBe(false);
    await tools.call("skill_trainer_read_file", { path: "README.md" });
    expect(tools.sawRead).toBe(true);
    expect(await fs.readFile(path.join(root, "README.md"), "utf8")).toBe("The repository.");
  });

  it("rejects traversal and direct or ancestor symlinks for reads and writes", async () => {
    await fs.mkdir(path.join(root, "inside"));
    await fs.writeFile(path.join(root, "inside", "secret"), "secret");
    await fs.symlink(path.join(root, "inside"), path.join(root, "link"));
    const tools = codexFileTools(rootedFs(root), false, root);
    expect((await tools.call("skill_trainer_read_file", { path: "../outside" })).success).toBe(false);
    expect((await tools.call("skill_trainer_read_file", { path: "link/secret" })).success).toBe(false);
    expect((await tools.call("skill_trainer_write_file", { path: "link/secret", content: "changed" })).success).toBe(false);
    expect(await fs.readFile(path.join(root, "inside", "secret"), "utf8")).toBe("secret");
    expect(tools.sawRead).toBe(false);
  });
});
