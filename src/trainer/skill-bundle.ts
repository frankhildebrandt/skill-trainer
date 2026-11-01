import { translate as translateMessage, type Translate } from "../shared/i18n";
import { LocalizedError } from "../shared/localized-error";
import fs from "node:fs/promises";
import path from "node:path";
import type { FileEdit, SkillFile, SkippedEdit } from "../shared/types";
import { frontmatterName } from "./skill-file";

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__"]);
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
  if (!stat) throw new LocalizedError("files.skillPathMissing");
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
  throw new LocalizedError("files.skillNotFound");
}

export async function loadSkillBundle(picked: string): Promise<SkillBundle> {
  const root = await resolveSkillRoot(picked);
  const document = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
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
    return { path: "SKILL.md", text, ...(file.executable === undefined ? {} : { executable: file.executable }) };
  });
  if (!found) next.unshift({ path: "SKILL.md", text });
  return next;
}

export function sameBundle(leftDoc: string, rightDoc: string, left: SkillFile[] = [], right: SkillFile[] = []): boolean {
  if (leftDoc.trim() !== rightDoc.trim()) return false;
  if (left.length !== right.length) return false;
  for (const file of right) {
    const other = left.find((item) => item.path === file.path);
    if (!other || other.text !== file.text || other.base64 !== file.base64 || other.executable !== file.executable) return false;
  }
  return true;
}

export async function writeSkillTree(destRoot: string, files: SkillFile[]): Promise<void> {
  for (const file of files) {
    const relative = sanitizeRelative(file.path);
    if (!relative) throw new LocalizedError("files.invalidFilePath", { path: file.path });
    const target = path.resolve(destRoot, relative);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new LocalizedError("files.outsideFolder", { path: file.path });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file.base64) await fs.writeFile(target, Buffer.from(file.base64, "base64"));
    else await fs.writeFile(target, file.text ?? "");
    if (file.executable !== undefined) {
      const stat = await fs.stat(target);
      await fs.chmod(target, file.executable ? stat.mode | 0o111 : stat.mode & ~0o111);
    }
  }
}

export interface FileApplyResult {
  files: SkillFile[];
  applied: FileEdit[];
  skipped: SkippedEdit[];
}

export interface FileApplyOptions {
  translate?: Translate;
  maxFileChars?: number;
  allowSkillDocument?: boolean;
}

export function applyFileEdits(files: SkillFile[], edits: FileEdit[], limit: number, options: FileApplyOptions = {}): FileApplyResult {
  const t: Translate = options.translate ?? ((key, values) => translateMessage("de", key, values));
  const next = files.map((file) => ({ ...file }));
  const applied: FileEdit[] = [];
  const skipped: SkippedEdit[] = [];
  for (const edit of edits) {
    if (applied.length >= limit) {
      skipped.push({ edit: asSkillEdit(edit), reason: t("files.learningRateReached") });
      continue;
    }
    const relative = sanitizeRelative(edit.path);
    if (!relative) {
      skipped.push({ edit: asSkillEdit(edit), reason: t("files.invalidPath") });
      continue;
    }
    if (relative === "SKILL.md" && (!options.allowSkillDocument || edit.op === "delete")) {
      skipped.push({ edit: asSkillEdit(edit), reason: t("files.skillDocumentViaText") });
      continue;
    }
    const outcome = applyFile(next, { ...edit, path: relative }, options.maxFileChars ?? MAX_WRITE_CHARS, t);
    if (outcome.ok) applied.push({ ...edit, path: relative });
    else skipped.push({ edit: asSkillEdit(edit), reason: outcome.reason });
  }
  return { files: next, applied, skipped };
}

async function collectFiles(root: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
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
      const relative = path.relative(root, full).split(path.sep).join("/");
      const buf = await fs.readFile(full);
      const stat = await fs.stat(full);
      const executable = (stat.mode & 0o111) !== 0;
      if (buf.includes(0)) {
        files.push({ path: relative, base64: buf.toString("base64"), executable });
        continue;
      }
      const text = buf.toString("utf8");
      files.push({ path: relative, text, executable });
    }
  }
  await walk(root);
  return files;
}

function applyFile(files: SkillFile[], edit: FileEdit, maxFileChars: number, t: Translate): { ok: true } | { ok: false; reason: string } {
  if (edit.op === "delete") {
    const index = files.findIndex((file) => file.path === edit.path);
    if (index === -1) return { ok: false, reason: t("files.fileNotFound") };
    files.splice(index, 1);
    return { ok: true };
  }
  if (edit.content.length > maxFileChars) return { ok: false, reason: t("files.fileEditTooLong") };
  if (edit.op === "write") {
    if (edit.path === "SKILL.md" && !edit.content.trim()) return { ok: false, reason: t("files.emptySkillDocument") };
    if (files.some((file) => file.path.startsWith(`${edit.path}/`) || edit.path.startsWith(`${file.path}/`))) {
      return { ok: false, reason: t("files.pathCollision") };
    }
    const existing = files.find((file) => file.path === edit.path);
    const text = edit.content && !edit.content.endsWith("\n") ? `${edit.content}\n` : edit.content;
    if (existing) {
      existing.text = text;
      delete existing.base64;
      if (edit.executable !== undefined) existing.executable = edit.executable;
    } else files.push({ path: edit.path, text, executable: edit.executable ?? text.startsWith("#!") });
    return { ok: true };
  }
  const existing = files.find((file) => file.path === edit.path);
  if (!existing?.text) return { ok: false, reason: t("files.fileNotFound") };
  if (!edit.target) return { ok: false, reason: t("files.targetMissing") };
  const hits = existing.text.split(edit.target).length - 1;
  if (hits === 0) return { ok: false, reason: t("files.targetNotFound") };
  if (hits > 1) return { ok: false, reason: t("files.targetAmbiguous") };
  const text = existing.text.replace(edit.target, () => edit.content);
  if (edit.path === "SKILL.md" && !text.trim()) return { ok: false, reason: t("files.emptySkillDocument") };
  existing.text = text;
  if (edit.executable !== undefined) existing.executable = edit.executable;
  return { ok: true };
}

export function sanitizeRelative(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized || path.isAbsolute(normalized) || path.win32.isAbsolute(value) ||
    /^[a-z]:/i.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "." || part === "" || part.toLowerCase() === ".git")
  ) {
    return null;
  }
  return normalized;
}

function asSkillEdit(edit: FileEdit): SkippedEdit["edit"] {
  return { op: "replace", target: edit.target ?? edit.path, content: edit.content, why: edit.why };
}

async function assertSkillMarkdown(dir: string): Promise<void> {
  if (!(await exists(path.join(dir, "SKILL.md")))) {
    throw new LocalizedError("files.noSkillDocument");
  }
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
}
