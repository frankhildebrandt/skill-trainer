import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectSkill } from "../shared/types";
import { assertSafeWorkspace } from "./isolate";
import { frontmatterName } from "./skill-file";

export type { ProjectSkill };

const SKIP = new Set(["node_modules", ".venv", "venv", "target", ".next", "dist", "out", "build", "coverage", "__pycache__", ".git"]);
const DOT_DIRS = new Set([".cursor", ".agents", ".codex"]);
const MAX_DEPTH = 8;
const MAX_SKILLS = 100;

/** Skills are directories that contain a SKILL.md inside the project. */
export async function listProjectSkills(workspace: string): Promise<ProjectSkill[]> {
  const root = await fs.realpath(path.resolve(workspace));
  assertSafeWorkspace(root);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Der Projektpfad ist kein Ordner.");
  const found: ProjectSkill[] = [];
  await walk(root, root, 0, found);
  found.sort((left, right) => left.relative.localeCompare(right.relative));
  return found;
}

async function walk(workspace: string, dir: string, depth: number, found: ProjectSkill[]): Promise<void> {
  if (found.length >= MAX_SKILLS) return;
  const skillFile = path.join(dir, "SKILL.md");
  if (await isFile(skillFile)) {
    const text = await fs.readFile(skillFile, "utf8");
    const relative = path.relative(workspace, dir);
    found.push({
      root: dir,
      relative: relative || ".",
      name: frontmatterName(text) ?? path.basename(dir),
    });
    return;
  }
  if (depth >= MAX_DEPTH) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of dirs) {
    if (SKIP.has(entry.name)) continue;
    if (entry.name.startsWith(".") && !DOT_DIRS.has(entry.name)) continue;
    await walk(workspace, path.join(dir, entry.name), depth + 1, found);
    if (found.length >= MAX_SKILLS) return;
  }
}

async function isFile(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  return Boolean(stat?.isFile());
}
