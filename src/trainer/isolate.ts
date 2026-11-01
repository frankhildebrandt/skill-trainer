import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HEAVY = new Set(["node_modules", ".venv", "venv", "target", ".next", "dist", "out", "build", "coverage", "__pycache__"]);

const locks = new Map<string, Promise<void>>();

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
    throw new Error("Dieser Ordner ist zu breit. Wähle den Projektordner, nicht dein Home-Verzeichnis.");
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

export async function isolateWorkspace(src: string, dest: string): Promise<Isolation> {
  assertSafeWorkspace(src);
  const source = await fs.realpath(src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const git = await isGitRepo(source);

  if (git) {
    const key = await gitCommonDir(source);
    await withLock(key, async () => {
      await runGit(["worktree", "add", "--detach", dest, "HEAD"], source);
    });
    await copyDirty(source, dest);
    await cloneHeavyDirs(source, dest);
    const baseCommit = (await runGit(["rev-parse", "HEAD"], dest)).trim();
    return holdIsolation(dest, baseCommit, () => removeWorktree(source, dest));
  }

  await copyTree(source, dest);
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
            new Error(
              `Die Kopie von ${name} ist fehlgeschlagen (${code}). Der Lauf braucht eine eigene Kopie, kein Link auf dein Original.`,
            ),
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

async function removeWorktree(src: string, dest: string): Promise<void> {
  const key = await gitCommonDir(src).catch(() => src);
  await withLock(key, async () => {
    await runGit(["worktree", "remove", "--force", dest], src).catch(async () => {
      await fs.rm(dest, { recursive: true, force: true });
      await runGit(["worktree", "prune"], src).catch(() => undefined);
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

async function gitCommonDir(cwd: string): Promise<string> {
  const raw = (await runGit(["rev-parse", "--git-common-dir"], cwd)).trim();
  return path.resolve(cwd, raw);
}

function gitIdentity(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: "skill-trainer",
    GIT_AUTHOR_EMAIL: "skill-trainer@localhost",
    GIT_COMMITTER_NAME: "skill-trainer",
    GIT_COMMITTER_EMAIL: "skill-trainer@localhost",
  };
}

function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function runGit(args: string[], cwd: string, extraEnv?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...extraEnv },
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
      else reject(new Error(stderr.trim() || `git ${args[0]} ist fehlgeschlagen (${code})`));
    });
  });
}
