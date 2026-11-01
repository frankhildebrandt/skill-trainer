import fs from "node:fs/promises";
import path from "node:path";
import type { FileEdit, SkillFile, SkippedEdit } from "../shared/types";
import { frontmatterName } from "./skill-file";

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "dist", "out", "build", "coverage", "__pycache__", ".next", "target"]);
const MAX_FILES = 60;
const MAX_TEXT_CHARS = 120_000;
const MAX_BINARY_BYTES = 400_000;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_WRITE_CHARS = 12_000;

export interface SkillBundle {
  root: string;
  document: string;
  files: SkillFile[];
  name: string;
}

export async function resolveSkillRoot(picked: string): Promise<string> {
  const resolved = path.resolve(picked);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) throw new Error("Der Skill-Pfad existiert nicht.");
  if (stat.isDirectory()) {
    await assertSkillMarkdown(resolved);
    return resolved;
  }
  if (path.basename(resolved) === "SKILL.md") return path.dirname(resolved);
  let dir = path.dirname(resolved);
  for (let depth = 0; depth < 6; depth += 1) {
    if (await exists(path.join(dir, "SKILL.md"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Keine SKILL.md gefunden. Wähle den Skill-Ordner oder die SKILL.md darin.");
}

export async function loadSkillBundle(picked: string): Promise<SkillBundle> {
  const root = await resolveSkillRoot(picked);
  const document = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
  if (document.length > 200_000) throw new Error("Die SKILL.md ist größer als 200 KB.");
  const files = await collectFiles(root);
  if (!files.some((file) => file.path === "SKILL.md")) {
    files.unshift({ path: "SKILL.md", text: document });
  }
  return {
    root,
    document,
    files: withDocument(files, document),
    name: frontmatterName(document) ?? path.basename(root),
  };
}

export function withDocument(files: SkillFile[], document: string): SkillFile[] {
  const text = document.endsWith("\n") ? document : `${document}\n`;
  let found = false;
  const next = files.map((file) => {
    if (file.path !== "SKILL.md") return file;
    found = true;
    return { path: "SKILL.md", text };
  });
  if (!found) next.unshift({ path: "SKILL.md", text });
  return next;
}

export function sameBundle(leftDoc: string, rightDoc: string, left: SkillFile[] = [], right: SkillFile[] = []): boolean {
  if (leftDoc.trim() !== rightDoc.trim()) return false;
  if (left.length !== right.length) return false;
  for (const file of right) {
    const other = left.find((item) => item.path === file.path);
    if (!other || other.text !== file.text || other.base64 !== file.base64) return false;
  }
  return true;
}

export async function writeSkillTree(destRoot: string, files: SkillFile[]): Promise<void> {
  for (const file of files) {
    const relative = sanitizeRelative(file.path);
    if (!relative) throw new Error(`Skill-Datei hat einen ungültigen Pfad: ${file.path}`);
    const target = path.resolve(destRoot, relative);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new Error(`Skill-Datei liegt außerhalb des Ordners: ${file.path}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file.base64) await fs.writeFile(target, Buffer.from(file.base64, "base64"));
    else await fs.writeFile(target, file.text ?? "");
  }
}

export interface FileApplyResult {
  files: SkillFile[];
  applied: FileEdit[];
  skipped: SkippedEdit[];
}

export function applyFileEdits(files: SkillFile[], edits: FileEdit[], limit: number): FileApplyResult {
  const next = files.map((file) => ({ ...file }));
  const applied: FileEdit[] = [];
  const skipped: SkippedEdit[] = [];
  for (const edit of edits) {
    if (applied.length >= limit) {
      skipped.push({ edit: asSkillEdit(edit), reason: "Lernrate erreicht" });
      continue;
    }
    const relative = sanitizeRelative(edit.path);
    if (!relative) {
      skipped.push({ edit: asSkillEdit(edit), reason: "Pfad ist ungültig" });
      continue;
    }
    if (relative === "SKILL.md") {
      skipped.push({ edit: asSkillEdit(edit), reason: "SKILL.md wird über die Text-Edits geändert" });
      continue;
    }
    const outcome = applyFile(next, { ...edit, path: relative });
    if (outcome.ok) applied.push({ ...edit, path: relative });
    else skipped.push({ edit: asSkillEdit(edit), reason: outcome.reason });
  }
  return { files: next, applied, skipped };
}

async function collectFiles(root: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  let total = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) throw new Error(`Der Skill-Ordner hat mehr als ${MAX_FILES} Dateien.`);
      const relative = path.relative(root, full).split(path.sep).join("/");
      const buf = await fs.readFile(full);
      total += buf.length;
      if (total > MAX_TOTAL_BYTES) throw new Error("Der Skill-Ordner ist größer als 2 MB.");
      if (buf.includes(0)) {
        if (buf.length > MAX_BINARY_BYTES) throw new Error(`${relative} ist als Binärdatei zu groß.`);
        files.push({ path: relative, base64: buf.toString("base64") });
        continue;
      }
      const text = buf.toString("utf8");
      if (text.length > MAX_TEXT_CHARS) throw new Error(`${relative} ist größer als ${MAX_TEXT_CHARS} Zeichen.`);
      files.push({ path: relative, text });
    }
  }
  await walk(root);
  return files;
}

function applyFile(files: SkillFile[], edit: FileEdit): { ok: true } | { ok: false; reason: string } {
  if (edit.op === "write") {
    if (!edit.content.trim()) return { ok: false, reason: "leerer Inhalt" };
    if (edit.content.length > MAX_WRITE_CHARS) return { ok: false, reason: "Datei-Edit ist zu lang" };
    const existing = files.find((file) => file.path === edit.path);
    if (existing?.base64) return { ok: false, reason: "Binärdatei bleibt unverändert" };
    if (existing) existing.text = edit.content.endsWith("\n") ? edit.content : `${edit.content}\n`;
    else files.push({ path: edit.path, text: edit.content.endsWith("\n") ? edit.content : `${edit.content}\n` });
    return { ok: true };
  }
  const existing = files.find((file) => file.path === edit.path);
  if (!existing?.text) return { ok: false, reason: "Datei nicht gefunden" };
  if (!edit.target) return { ok: false, reason: "Zieltext fehlt" };
  const hits = existing.text.split(edit.target).length - 1;
  if (hits === 0) return { ok: false, reason: "Zieltext nicht gefunden" };
  if (hits > 1) return { ok: false, reason: "Zieltext ist nicht eindeutig" };
  existing.text = existing.text.replace(edit.target, edit.content);
  return { ok: true };
}

export function sanitizeRelative(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.isAbsolute(value) || normalized.split("/").some((part) => part === ".." || part === "")) {
    return null;
  }
  return normalized;
}

function asSkillEdit(edit: FileEdit): SkippedEdit["edit"] {
  return { op: "replace", target: edit.target ?? edit.path, content: edit.content, why: edit.why };
}

async function assertSkillMarkdown(dir: string): Promise<void> {
  if (!(await exists(path.join(dir, "SKILL.md")))) {
    throw new Error("Im Ordner liegt keine SKILL.md.");
  }
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
}
