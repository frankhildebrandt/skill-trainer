import { LocalizedError } from "../shared/localized-error";
import fs from "node:fs/promises";
import path from "node:path";

/** Relative to the worktree. The harness owns this tree and restores it before grading. */
export const CHECKS_DIR = ".skill-trainer/checks";
export const CHECK_ENTRY = `${CHECKS_DIR}/run.sh`;
export const CHECK_COMMAND = `sh ${CHECK_ENTRY}`;

const MAX_FILES = 24;
const MAX_FILE_CHARS = 80_000;
const MAX_TOTAL_CHARS = 400_000;

export interface CheckFile {
  /** Path relative to the worktree, always under `.skill-trainer/checks/`. */
  path: string;
  text: string;
}

export function assertChecks(files: CheckFile[]): void {
  if (files.length > MAX_FILES) throw new LocalizedError("diagnostics.tooManyCheckFiles", { count: MAX_FILES });
  let total = 0;
  let entry = "";
  for (const file of files) {
    const relative = normalizeCheckPath(file.path);
    if (!relative) throw new LocalizedError("diagnostics.checkOutside", { directory: CHECKS_DIR, path: file.path });
    if (relative === CHECK_ENTRY) entry = file.text;
    if (file.text.includes("\0")) throw new LocalizedError("diagnostics.notTextFile", { path: relative });
    if (file.text.length > MAX_FILE_CHARS) throw new LocalizedError("diagnostics.fileTooLong", { path: relative });
    total += file.text.length;
  }
  if (entry === "") throw new LocalizedError("diagnostics.missingCheckEntry", { path: CHECK_ENTRY });
  if (!entry.trim()) throw new LocalizedError("diagnostics.emptyCheck");
  if (total > MAX_TOTAL_CHARS) throw new LocalizedError("diagnostics.checkTooLarge");
}

export async function harvestChecks(root: string): Promise<CheckFile[]> {
  const dir = path.join(root, CHECKS_DIR);
  const files: CheckFile[] = [];
  await walk(dir, root, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  assertChecks(files);
  return files;
}

export async function plantChecks(root: string, files: CheckFile[]): Promise<void> {
  assertChecks(files);
  const dir = path.join(root, CHECKS_DIR);
  await fs.rm(dir, { recursive: true, force: true });
  for (const file of files) {
    const relative = normalizeCheckPath(file.path);
    if (!relative) throw new LocalizedError("diagnostics.checkOutside", { directory: CHECKS_DIR, path: file.path });
    const target = path.resolve(root, relative);
    const allowed = path.resolve(root, CHECKS_DIR);
    if (target !== allowed && !target.startsWith(allowed + path.sep)) {
      throw new LocalizedError("diagnostics.checkOutside", { directory: CHECKS_DIR, path: file.path });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.text);
  }
}

export async function writeChecks(destDir: string, files: CheckFile[]): Promise<void> {
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });
  for (const file of files) {
    const relative = normalizeCheckPath(file.path);
    if (!relative) continue;
    const stripped = relative.slice(CHECKS_DIR.length + 1);
    const target = path.join(destDir, stripped);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.text);
  }
  await fs.writeFile(path.join(destDir, "command.txt"), `${CHECK_COMMAND}\n`);
}

function normalizeCheckPath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith(`${CHECKS_DIR}/`)) return null;
  if (normalized.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return normalized;
}

async function walk(dir: string, root: string, files: CheckFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(full, root, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, full).split(path.sep).join("/");
    const text = await fs.readFile(full, "utf8");
    files.push({ path: relative, text });
  }
}
