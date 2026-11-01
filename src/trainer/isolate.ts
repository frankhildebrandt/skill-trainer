import { LocalizedError } from "../shared/localized-error";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HEAVY = new Set(["node_modules", ".venv", "venv", "target", ".next", "dist", "out", "build", "coverage", "__pycache__"]);

export interface Isolation {
  dir: string;
  readonly baseCommit: string | null;
  /** Move the diff baseline to a later commit, so harness files drop out of the agent diff. */
  noteCommit: (commit: string) => void;
  diff: () => Promise<{ stat: string; patch: string }>;
  cleanup: () => Promise<void>;
}

export interface PorcelainEntry {
  code: string;
  path: string;
  from?: string;
}

export function assertSafeWorkspace(dir: string): void {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === path.resolve(os.homedir())) {
    throw new LocalizedError("diagnostics.workspaceTooBroad");
  }
}

export function parsePorcelainZ(text: string): PorcelainEntry[] {
  const parts = text.split("\0").filter((part) => part.length > 0);
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < parts.length; ) {
    const entry = parts[index] ?? "";
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code.includes("R") || code.includes("C")) {
      entries.push({ code, path: parts[index + 1] ?? "", from: file });
      index += 2;
      continue;
    }
    entries.push({ code, path: file });
    index += 1;
  }
  return entries;
}

/** A git repo with an empty root commit and no project files. */
export async function createEmptyRepo(dest: string): Promise<Isolation> {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await runGit(["init"], dest);
  await runGit(["commit", "--allow-empty", "-m", "empty", "--no-verify"], dest, gitIdentity());
  const baseCommit = (await runGit(["rev-parse", "HEAD"], dest)).trim();
  return holdIsolation(dest, baseCommit, async () => {
    await fs.rm(dest, { recursive: true, force: true });
  });
}

/** Snapshot the working tree into a new git repo. The source checkout is only read. */
export async function isolateWorkspace(src: string, dest: string): Promise<Isolation> {
  assertSafeWorkspace(src);
  const source = await fs.realpath(src);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await isGitRepo(source)) {
    await fs.mkdir(dest);
    await archiveHead(source, dest);
    await copyDirty(source, dest);
  } else {
    await copyTree(source, dest);
  }
  await cloneHeavyDirs(source, dest);
  await runGit(["init"], dest);
  await runGit(["add", "-A"], dest);
  await runGit(["commit", "--allow-empty", "-m", "skill-trainer snapshot", "--no-verify"], dest, gitIdentity());
  const baseCommit = (await runGit(["rev-parse", "HEAD"], dest)).trim();
  return holdIsolation(dest, baseCommit, async () => {
    await fs.rm(dest, { recursive: true, force: true });
  });
}

/** Commit `.skill-trainer` and hide it from the later agent diff. */
export async function pinChecks(iso: Isolation): Promise<void> {
  await runGit(["add", "-f", "-A", "--", ".skill-trainer"], iso.dir);
  const status = await runGit(["status", "--porcelain", "--", ".skill-trainer"], iso.dir);
  if (status.trim()) {
    await runGit(
      ["commit", "-m", "skill-trainer checks", "--no-verify", "--", ".skill-trainer"],
      iso.dir,
      gitIdentity(),
    );
  }
  iso.noteCommit((await runGit(["rev-parse", "HEAD"], iso.dir)).trim());
}

function holdIsolation(dest: string, commit: string, cleanup: () => Promise<void>): Isolation {
  const state = { commit };
  return {
    dir: dest,
    get baseCommit() {
      return state.commit;
    },
    noteCommit(next: string) {
      state.commit = next;
    },
    diff: () => diffAgainst(dest, state.commit),
    cleanup,
  };
}

async function copyDirty(src: string, dest: string): Promise<void> {
  const status = await runGit(["status", "--porcelain=v1", "-z", "-uall"], src);
  for (const entry of parsePorcelainZ(status)) {
    if (entry.from) {
      await fs.rm(path.join(dest, entry.from), { recursive: true, force: true });
    }
    const deleted = entry.code.trim() === "D" || entry.code === " D" || entry.code === "D ";
    if (deleted) {
      await fs.rm(path.join(dest, entry.path), { recursive: true, force: true });
      continue;
    }
    await copyEntry(src, dest, entry.path);
  }
}

async function copyEntry(src: string, dest: string, rel: string): Promise<void> {
  if (!rel || rel.split(/[\\/]/).some((part) => part === ".git" || HEAVY.has(part))) return;
  const from = path.join(src, rel);
  const to = path.join(dest, rel);
  const stat = await fs.lstat(from).catch(() => null);
  if (!stat) {
    await fs.rm(to, { recursive: true, force: true });
    return;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (stat.isDirectory()) {
    await fs.cp(from, to, { recursive: true, filter: (candidate) => keepPath(candidate) });
    return;
  }
  await fs.copyFile(from, to);
}

async function copyTree(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (candidate) => keepPath(candidate),
  });
}

function keepPath(candidate: string): boolean {
  const base = path.basename(candidate);
  return base !== ".git" && !HEAVY.has(base);
}

async function cloneHeavyDirs(src: string, dest: string): Promise<void> {
  for (const name of ["node_modules", ".venv", "venv"]) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = await fs.lstat(from).catch(() => null);
    if (!stat?.isDirectory()) continue;
    if (await fs.lstat(to).catch(() => null)) continue;
    await new Promise<void>((resolve, reject) => {
      const child = spawn("cp", ["-cR", from, to], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else {
          reject(
            new LocalizedError("diagnostics.dependencyCopyFailed", { name, code: code ?? "null" }),
          );
        }
      });
    });
  }
}

async function diffAgainst(dest: string, base: string): Promise<{ stat: string; patch: string }> {
  // New files stay invisible to git diff until they are intent-added. Empty-repo
  // runs consist almost entirely of files the agent creates.
  await runGit(["add", "--intent-to-add", "."], dest).catch(() => undefined);
  const stat = await runGit(["diff", "--stat", base], dest).catch(() => "");
  const patch = await runGit(["diff", base], dest).catch(() => "");
  return {
    stat: stat.trim().slice(0, 4000),
    patch: patch.trim().slice(0, 12_000),
  };
}

function archiveHead(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn("git", ["archive", "--format=tar", "HEAD"], { cwd: src, env: gitEnv() });
    const tar = spawn("tar", ["-x", "-C", dest]);
    if (!git.stdout || !git.stderr || !tar.stdin || !tar.stderr) {
      git.kill();
      tar.kill();
      reject(new LocalizedError("diagnostics.projectCopyStart"));
      return;
    }
    const errors: string[] = [];
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    git.stderr.setEncoding("utf8");
    tar.stderr.setEncoding("utf8");
    git.stderr.on("data", (chunk: string) => {
      errors.push(chunk);
    });
    tar.stderr.on("data", (chunk: string) => {
      errors.push(chunk);
    });
    git.stdout.pipe(tar.stdin);
    let gitCode: number | null = null;
    let tarCode: number | null = null;
    const finish = () => {
      if (gitCode === null || tarCode === null) return;
      if (gitCode === 0 && tarCode === 0) succeed();
      else fail(errors.join("").trim() ? new Error(errors.join("").trim()) : new LocalizedError("diagnostics.projectCopyFailed", { gitCode, tarCode }));
    };
    git.on("error", (error) => fail(error));
    tar.on("error", (error) => fail(error));
    git.on("close", (code) => {
      gitCode = code ?? 1;
      if (gitCode !== 0) tar.stdin?.end();
      finish();
    });
    tar.on("close", (code) => {
      tarCode = code ?? 1;
      finish();
    });
  });
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const inside = (await runGit(["rev-parse", "--is-inside-work-tree"], cwd)).trim();
    if (inside !== "true") return false;
    await runGit(["rev-parse", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

function gitIdentity(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: "skill-trainer",
    GIT_AUTHOR_EMAIL: "skill-trainer@localhost",
    GIT_COMMITTER_NAME: "skill-trainer",
    GIT_COMMITTER_EMAIL: "skill-trainer@localhost",
  };
}

function gitEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extraEnv };
}

function runGit(args: string[], cwd: string, extraEnv?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnv(extraEnv),
    });
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
      else reject(stderr.trim() ? new Error(stderr.trim()) : new LocalizedError("diagnostics.gitFailed", { command: args[0] ?? "undefined", code: code ?? "null" }));
    });
  });
}
