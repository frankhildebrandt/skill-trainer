import type { SkillEdit, SkippedEdit } from "../shared/types";

export const SLOW_START = "<!-- skill-trainer:slow -->";
export const SLOW_END = "<!-- /skill-trainer:slow -->";

const MAX_EDIT_CHARS = 1800;
const MAX_ADDED_CHARS = 2500;

export interface ApplyOptions {
  limit: number;
  maxAddedChars?: number;
  maxEditChars?: number;
  protectSlowRegion?: boolean;
}

export interface ApplyResult {
  skill: string;
  applied: SkillEdit[];
  skipped: SkippedEdit[];
}

export function applyEdits(skill: string, edits: SkillEdit[], options: ApplyOptions): ApplyResult {
  const limit = Math.max(0, options.limit);
  const maxAdded = options.maxAddedChars ?? MAX_ADDED_CHARS;
  const maxEditChars = options.maxEditChars ?? MAX_EDIT_CHARS;
  const applied: SkillEdit[] = [];
  const skipped: SkippedEdit[] = [];
  let next = skill;
  let added = 0;

  for (const edit of edits) {
    if (applied.length >= limit) {
      skipped.push({ edit, reason: "Lernrate erreicht" });
      continue;
    }
    const outcome = applyOne(next, edit, maxAdded - added, maxEditChars, options.protectSlowRegion !== false);
    if (outcome.ok) {
      next = outcome.skill;
      added += outcome.added;
      applied.push(edit);
    } else {
      skipped.push({ edit, reason: outcome.reason });
    }
  }

  return { skill: next, applied, skipped };
}

export function setSlowRegion(skill: string, lessons: string, maxChars = 2000): string {
  const body = lessons.trim().slice(0, maxChars);
  if (!body) return skill;
  const block = `${SLOW_START}\n${body}\n${SLOW_END}`;
  const start = skill.indexOf(SLOW_START);
  const end = skill.indexOf(SLOW_END);
  if (start !== -1 && end !== -1 && end > start) {
    return `${skill.slice(0, start)}${block}${skill.slice(end + SLOW_END.length)}`;
  }
  const trimmed = skill.replace(/\s*$/, "");
  return `${trimmed}\n\n${block}\n`;
}

function applyOne(
  skill: string,
  edit: SkillEdit,
  room: number,
  maxEditChars: number,
  protectSlowRegion: boolean,
): { ok: true; skill: string; added: number } | { ok: false; reason: string } {
  if (edit.op !== "delete" && !edit.content.trim()) {
    return { ok: false, reason: "leerer Inhalt" };
  }
  if (edit.content.length > maxEditChars) {
    return { ok: false, reason: "Edit ist zu lang" };
  }

  if (edit.op === "append") {
    const chunk = edit.content.replace(/^\n*/, "\n");
    if (chunk.trim().length > room) return { ok: false, reason: "Zeichenbudget erreicht" };
    return { ok: true, skill: insertBeforeSlow(skill, chunk, protectSlowRegion), added: chunk.trim().length };
  }

  if (!edit.target) return { ok: false, reason: "Zieltext fehlt" };
  const span = protectSlowRegion ? slowSpan(skill) : null;
  const hits = countOutsideSlow(skill, edit.target, span);
  if (hits === 0) return { ok: false, reason: "Zieltext nicht gefunden" };
  if (hits > 1) return { ok: false, reason: "Zieltext ist nicht eindeutig" };

  if (edit.op === "delete") {
    return { ok: true, skill: replaceOutsideSlow(skill, edit.target, "", span), added: 0 };
  }

  if (edit.op === "replace") {
    const added = Math.max(0, edit.content.length - edit.target.length);
    if (added > room) return { ok: false, reason: "Zeichenbudget erreicht" };
    return { ok: true, skill: replaceOutsideSlow(skill, edit.target, edit.content, span), added };
  }

  if (edit.op === "insert_after") {
    const chunk = edit.content.startsWith("\n") ? edit.content : `\n${edit.content}`;
    if (chunk.trim().length > room) return { ok: false, reason: "Zeichenbudget erreicht" };
    return {
      ok: true,
      skill: replaceOutsideSlow(skill, edit.target, `${edit.target}${chunk}`, span),
      added: chunk.trim().length,
    };
  }

  return { ok: false, reason: "unbekannte Operation" };
}

function slowSpan(skill: string): { start: number; end: number } | null {
  const start = skill.indexOf(SLOW_START);
  const end = skill.indexOf(SLOW_END);
  if (start === -1 || end === -1 || end < start) return null;
  return { start, end: end + SLOW_END.length };
}

function countOutsideSlow(skill: string, needle: string, span: { start: number; end: number } | null): number {
  let count = 0;
  let from = 0;
  while (from <= skill.length) {
    const at = skill.indexOf(needle, from);
    if (at === -1) break;
    const inside = span !== null && at < span.end && at + needle.length > span.start;
    if (!inside) count += 1;
    from = at + Math.max(needle.length, 1);
  }
  return count;
}

function replaceOutsideSlow(skill: string, needle: string, replacement: string, span: { start: number; end: number } | null): string {
  const at = indexOutside(skill, needle, span);
  if (at === -1) return skill;
  return skill.slice(0, at) + replacement + skill.slice(at + needle.length);
}

function indexOutside(skill: string, needle: string, span: { start: number; end: number } | null): number {
  let from = 0;
  while (from <= skill.length) {
    const at = skill.indexOf(needle, from);
    if (at === -1) return -1;
    const inside = span !== null && at < span.end && at + needle.length > span.start;
    if (!inside) return at;
    from = at + Math.max(needle.length, 1);
  }
  return -1;
}

function insertBeforeSlow(skill: string, chunk: string, protectSlowRegion: boolean): string {
  const span = protectSlowRegion ? slowSpan(skill) : null;
  if (!span) return skill.replace(/\s*$/, "") + chunk + "\n";
  const head = skill.slice(0, span.start).replace(/\s*$/, "");
  return `${head}${chunk}\n\n${skill.slice(span.start)}`;
}
