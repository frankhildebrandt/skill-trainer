import type { Locale } from "../shared/i18n";
import { LocalizedError } from "../shared/localized-error";
import type { SkillFile } from "../shared/types";
import { extractJson } from "./json";

export interface SkillFields {
  ziel: string;
  auftrag: string;
}

const FIELD_CHARS = 4000;
const SKILL_CHARS = 40_000;
const FILE_CHARS = 12_000;
const FILES_CHARS = 48_000;

const OUTPUT_LANGUAGES: Record<Locale, string> = {
  de: "German",
  en: "English",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  nl: "Dutch",
};

/** Asks the selected model for goal and assignment fields in the form’s language. */
export function buildSkillFieldsPrompt(input: { skill: string; files?: SkillFile[]; locale?: Locale }): string {
  const language = OUTPUT_LANGUAGES[input.locale ?? "de"];
  const skill = clipBlock(input.skill, SKILL_CHARS);
  return `You read one skill folder and fill two fields of a trainer form in ${language}. Do not call tools. Do not edit files. Do not search the disk.

"ziel" says what this skill is for, in plain ${language}: the situations, the outcome, and the procedure it should produce. Two to five sentences. No title. Do not copy the skill verbatim.

"auftrag" is one concrete assignment, in ${language}, that a later agent can carry out with this skill and that a test can grade. Name the result that assignment must produce. Do not restate the skill, and do not include the solution.

Reply with one JSON object and nothing else:
{
  "ziel": "...",
  "auftrag": "..."
}

Current skill (${input.skill.length} characters):
<skill>
${skill}
</skill>

Other skill files:
${formatSkillFiles(input.files ?? [])}
`;
}

export function parseSkillFields(value: unknown): SkillFields {
  if (!value || typeof value !== "object") throw new LocalizedError("analysis.responseNotObject");
  const record = value as Record<string, unknown>;
  const ziel = field(record, ["ziel", "goal", "brief"]);
  const auftrag = field(record, ["auftrag", "task", "assignment"]);
  if (!ziel || !auftrag) throw new LocalizedError("analysis.missingFields");
  return { ziel: clipField(ziel), auftrag: clipField(auftrag) };
}

export function readSkillFields(text: string): SkillFields {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch {
    throw new LocalizedError("analysis.incompleteJson");
  }
  return parseSkillFields(value);
}

export function hasSkillFields(text: string): boolean {
  try {
    readSkillFields(text);
    return true;
  } catch {
    return false;
  }
}

function field(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatSkillFiles(files: SkillFile[]): string {
  const others = files.filter((file) => file.path !== "SKILL.md");
  if (others.length === 0) return "(none)";
  let used = 0;
  const blocks: string[] = [];
  for (const file of others) {
    if (used >= FILES_CHARS) {
      blocks.push("…[more files omitted]");
      break;
    }
    const body = file.base64 ? "(binary, not included)" : clipBlock(file.text ?? "", Math.min(FILE_CHARS, FILES_CHARS - used));
    const block = `--- ${file.path}${file.executable ? " (executable)" : ""} ---\n${body}`;
    blocks.push(block);
    used += body.length;
  }
  return blocks.join("\n\n");
}

function clipField(text: string): string {
  return text.length <= FIELD_CHARS ? text : `${text.slice(0, FIELD_CHARS)}…`;
}

function clipBlock(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}
