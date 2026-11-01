import { firstJsonObject } from "../shared/json-object";
import type { EditOp, FileEdit, SkillEdit } from "../shared/types";
import { sanitizeRelative } from "./skill-bundle";

const OPS: EditOp[] = ["append", "insert_after", "replace", "delete"];

export interface Proposal {
  reasoning: string;
  edits: SkillEdit[];
  files?: FileEdit[];
  slow: string | null;
}

export function extractJson(text: string): unknown {
  const raw = firstJsonObject(text);
  if (!raw) throw new Error("Die Optimierer-Antwort enthält kein vollständiges JSON-Objekt.");
  return JSON.parse(raw) as unknown;
}

export function parseProposal(value: unknown): Proposal {
  if (!value || typeof value !== "object") {
    throw new Error("Die Optimierer-Antwort ist kein Objekt.");
  }
  const record = value as Record<string, unknown>;
  const reasoning = typeof record.reasoning === "string" ? record.reasoning.trim() : "";
  const slow = typeof record.slow === "string" && record.slow.trim() ? record.slow.trim() : null;
  const edits = Array.isArray(record.edits) ? record.edits.flatMap(parseEdit) : [];
  const files = Array.isArray(record.files) ? record.files.flatMap(parseFileEdit) : [];
  return { reasoning, edits, files, slow };
}

function parseEdit(value: unknown): SkillEdit[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== "string" || !OPS.includes(op as EditOp)) return [];
  const content = typeof record.content === "string" ? record.content : "";
  const target = typeof record.target === "string" ? record.target : "";
  const why = typeof record.why === "string" ? record.why : undefined;
  return [{ op: op as EditOp, content, target, why }];
}

function parseFileEdit(value: unknown): FileEdit[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const op = record.op === "write" || record.op === "replace" || record.op === "delete" ? record.op : null;
  if (!op || typeof record.path !== "string") return [];
  const relative = sanitizeRelative(record.path);
  if (!relative) return [];
  const content = typeof record.content === "string" ? record.content : "";
  const target = typeof record.target === "string" ? record.target : undefined;
  const why = typeof record.why === "string" ? record.why : undefined;
  const executable = typeof record.executable === "boolean" ? record.executable : undefined;
  return [{ op, path: relative, content, target, why, ...(executable === undefined ? {} : { executable }) }];
}
