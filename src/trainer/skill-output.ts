import { LocalizedError } from "../shared/localized-error";
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillFile } from "../shared/types";
import { loadSkillBundle, sanitizeRelative } from "./skill-bundle";

interface SkillOutput {
  destination: string;
  files: SkillFile[];
  originalFiles?: SkillFile[];
  create: boolean;
  stamp: string;
}

/** Stages a complete skill, preserves unrelated files, and keeps the original as a backup. */
export async function saveSkillOutput(input: SkillOutput): Promise<{ backupPath: string | null; skillPath: string }> {
  validateFiles(input.files);
  const requested = path.resolve(input.destination);
  if (requested === path.parse(requested).root) throw new LocalizedError("diagnostics.destinationRoot");
  const parent = path.dirname(requested);
  await fs.mkdir(parent, { recursive: true });
  const destination = path.join(await fs.realpath(parent), path.basename(requested));
  const original = await statOrMissing(destination);
  if (original?.isSymbolicLink()) throw new LocalizedError("diagnostics.destinationSymlink");
  if (input.create && original) throw new LocalizedError("diagnostics.destinationExists");
  if (!input.create && !original?.isDirectory()) throw new LocalizedError("diagnostics.destinationMissing");
  const originalFiles = input.originalFiles ?? (input.create ? [] : (await loadSkillBundle(destination)).files);
  if (!input.stamp || input.stamp.includes("/") || input.stamp.includes("\\")) {
    throw new LocalizedError("diagnostics.invalidBackupStamp");
  }

  const staging = await fs.mkdtemp(path.join(parent, ".skill-trainer-save-"));
  const candidate = path.join(staging, "skill");
  try {
    if (input.create) await fs.mkdir(candidate);
    else await fs.cp(destination, candidate, { recursive: true, verbatimSymlinks: true });
    await updateStagedTree(candidate, input.files, originalFiles);
    if (input.create) {
      await fs.mkdir(destination);
      try {
        await fs.rename(candidate, destination);
      } catch (error) {
        await fs.rmdir(destination).catch(() => undefined);
        throw error;
      }
      return { backupPath: null, skillPath: destination };
    }

    const backupPath = `${destination}.bak-${input.stamp}`;
    await fs.mkdir(backupPath);
    try {
      await fs.rename(destination, backupPath);
    } catch (error) {
      await fs.rmdir(backupPath).catch(() => undefined);
      throw error;
    }
    try {
      await fs.rename(candidate, destination);
    } catch (error) {
      await fs.rename(backupPath, destination);
      throw error;
    }
    return { backupPath, skillPath: destination };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function updateStagedTree(root: string, files: SkillFile[], originals: SkillFile[]): Promise<void> {
  const retained = new Set(files.map((file) => relativePath(file.path)));
  const managed = new Set(originals.map((file) => relativePath(file.path)));
  for (const original of originals) {
    const relative = relativePath(original.path);
    if (retained.has(relative)) continue;
    const target = await safeTarget(root, relative);
    const stat = await statOrMissing(target);
    if (stat && !stat.isFile()) throw new LocalizedError("diagnostics.originalNotFile", { path: relative });
    if (stat) {
      await fs.unlink(target);
      await pruneEmptyParents(root, path.dirname(target));
    }
  }
  for (const file of files) {
    const relative = relativePath(file.path);
    const target = await safeTarget(root, relative);
    if (!managed.has(relative) && await statOrMissing(target)) {
      throw new LocalizedError("diagnostics.unrelatedOverwrite", { path: relative });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.base64 !== undefined ? Buffer.from(file.base64, "base64") : file.text ?? "");
    if (file.executable !== undefined) {
      const mode = (await fs.stat(target)).mode;
      await fs.chmod(target, file.executable ? mode | 0o111 : mode & ~0o111);
    }
  }
}

async function pruneEmptyParents(root: string, directory: string): Promise<void> {
  let current = directory;
  while (current !== root) {
    try {
      await fs.rmdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") return;
      if (code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
}

function validateFiles(files: SkillFile[]): void {
  if (!files.some((file) => file.path === "SKILL.md" && file.text?.trim())) {
    throw new LocalizedError("diagnostics.emptySkill");
  }
  const paths = files.map((file) => relativePath(file.path));
  if (new Set(paths).size !== paths.length) throw new LocalizedError("diagnostics.duplicatePaths");
}

function relativePath(input: string): string {
  const relative = sanitizeRelative(input);
  if (!relative || relative.split("/").some((part) => part === "." || part.toLowerCase() === ".git")) {
    throw new LocalizedError("diagnostics.invalidSkillPath", { path: input });
  }
  return relative;
}

async function safeTarget(root: string, relative: string): Promise<string> {
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await statOrMissing(current);
    if (stat?.isSymbolicLink()) throw new LocalizedError("diagnostics.targetPathSymlink", { path: relative });
    if (stat && index < parts.length - 1 && !stat.isDirectory()) {
      throw new LocalizedError("diagnostics.targetNotDirectory", { path: relative });
    }
    if (stat && index === parts.length - 1 && !stat.isFile()) {
      throw new LocalizedError("diagnostics.targetNotFile", { path: relative });
    }
  }
  return current;
}

async function statOrMissing(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
