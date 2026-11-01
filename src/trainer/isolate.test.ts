import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeWorkspace, createEmptyRepo, isolateWorkspace, parsePorcelainZ } from "./isolate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("parsePorcelainZ", () => {
  it("reads renames and deletions from NUL records", () => {
    const entries = parsePorcelainZ(" M src/app.ts\0?? notes.md\0R  old.ts\0new.ts\0 D gone.ts\0");
    expect(entries).toEqual([
      { code: " M", path: "src/app.ts" },
      { code: "??", path: "notes.md" },
      { code: "R ", path: "new.ts", from: "old.ts" },
      { code: " D", path: "gone.ts" },
    ]);
  });
});

describe("isolateWorkspace", () => {
  it("snapshots a dirty git checkout without touching the original", async () => {
    const scratch = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(path.join(scratch, "git-template"), { recursive: true });
    const root = await fs.mkdtemp(path.join(scratch, "iso-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    const dest = path.join(root, "snap");
    await fs.mkdir(repo);
    await git(repo, ["init"]);
    await fs.writeFile(path.join(repo, "keep.txt"), "committed\n");
    await git(repo, ["add", "keep.txt"]);
    await git(repo, ["commit", "-m", "init"]);
    await fs.writeFile(path.join(repo, "keep.txt"), "dirty\n");
    await fs.writeFile(path.join(repo, "fresh.txt"), "untracked\n");

    const before = await snapshot(repo);
    const iso = await isolateWorkspace(repo, dest);
    expect(await fs.readFile(path.join(dest, "keep.txt"), "utf8")).toBe("dirty\n");
    expect(await fs.readFile(path.join(dest, "fresh.txt"), "utf8")).toBe("untracked\n");
    const common = (await gitOut(dest, ["rev-parse", "--git-common-dir"])).trim();
    expect(path.resolve(dest, common)).toBe(path.join(dest, ".git"));
    await fs.writeFile(path.join(dest, "keep.txt"), "agent\n");
    await git(dest, ["add", "keep.txt"]);
    await git(dest, ["commit", "-m", "agent"]);
    const diff = await iso.diff();
    expect(diff.patch).toContain("agent");
    expect(await snapshot(repo)).toEqual(before);
    expect(await fs.readFile(path.join(repo, "keep.txt"), "utf8")).toBe("dirty\n");
    await expect(fs.readFile(path.join(repo, "fresh.txt"), "utf8")).resolves.toBe("untracked\n");
    await iso.cleanup();
    await expect(fs.stat(dest)).rejects.toThrow();
    expect(await snapshot(repo)).toEqual(before);
  });

  it("starts an empty repository with no project files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-empty-"));
    roots.push(root);
    const dest = path.join(root, "blank");
    const iso = await createEmptyRepo(dest);
    const names = (await fs.readdir(dest)).filter((name) => name !== ".git");
    expect(names).toEqual([]);
    await fs.writeFile(path.join(dest, "addon.ts"), "export const addon = 1;\n");
    const diff = await iso.diff();
    expect(diff.patch).toContain("addon.ts");
    await iso.cleanup();
    await expect(fs.stat(dest)).rejects.toThrow();
  });

  it("refuses the home directory", () => {
    expect(() => assertSafeWorkspace(os.homedir())).toThrow(/Projektordner/);
  });
});

function snapshot(cwd: string): Promise<{ head: string; status: string; worktrees: string }> {
  return Promise.all([
    gitOut(cwd, ["rev-parse", "HEAD"]),
    gitOut(cwd, ["status", "--porcelain=v1", "-z", "-uall"]),
    gitOut(cwd, ["worktree", "list", "--porcelain"]),
  ]).then(([head, status, worktrees]) => ({ head, status, worktrees }));
}

function gitOut(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: gitEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} (${code}): ${stderr.trim()}`));
    });
  });
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_NAME: "skill-trainer",
    GIT_AUTHOR_EMAIL: "skill-trainer@localhost",
    GIT_COMMITTER_NAME: "skill-trainer",
    GIT_COMMITTER_EMAIL: "skill-trainer@localhost",
    GIT_TEMPLATE_DIR: path.join(process.cwd(), ".tmp-tests", "git-template"),
  };
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnv(),
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} (${code}): ${stderr.trim()}`));
    });
  });
}
