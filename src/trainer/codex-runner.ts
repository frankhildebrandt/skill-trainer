import os from "node:os";
import type { ActivityUpdate } from "../shared/run-log";
import type { Locale, Translate } from "../shared/i18n";
import { translate } from "../shared/i18n";
import { LocalizedError } from "../shared/localized-error";
import type { SkillFile } from "../shared/types";
import type { AgentTrace, ExecuteRequest } from "./attempt";
import { extractJson, parseProposal, type Proposal } from "./json";
import type { ProposeCall } from "./loop";
import { buildOptimizerPrompt } from "./prompts";
import { rootedFs } from "./rooted-fs";
import { isAbortError } from "./pool";
import { buildSkillFieldsPrompt, readSkillFields, type SkillFields } from "./skill-fields";
import { runCodexTurn } from "./codex-turn";

/** Executes a target model against its isolated attempt directory. */
export async function executeWithCodex(input: ExecuteRequest): Promise<AgentTrace> {
  const started = Date.now();
  try {
    const trace = await runCodexTurn(input);
    return { ...trace, finalText: trace.finalText.slice(0, 4000) };
  } catch (error) {
    if (!isAbortError(error) && !input.signal.aborted) throw error;
    return { status: "cancelled", finalText: "", toolCalls: 0, transcript: "", durationMs: Date.now() - started };
  }
}

/** Proposes skill edits, with read-only project tools for create and pretrain workflows. */
export async function proposeWithCodex(
  input: ProposeCall & { model: string; cwd: string; onActivity?: (update: ActivityUpdate) => void; translate?: Translate },
): Promise<Proposal> {
  const t: Translate = input.translate ?? ((key, values) => translate("de", key, values));
  const drafting = input.kind === "create" || input.kind === "pretrain";
  if (drafting && !input.workspacePath?.trim()) throw new LocalizedError("trainer.chooseProject");
  const cwd = drafting ? input.workspacePath! : input.cwd;
  const prompt = buildOptimizerPrompt(input);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const trace = await runCodexTurn({
      cwd, model: input.model, signal: input.signal, timeoutMs: 12 * 60_000,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nRead at least one repository file before returning your JSON proposal.`,
      onActivity: input.onActivity, settingSources: [], readOnly: true,
      ...(drafting ? { fs: rootedFs(cwd) } : {}), outputSchema: proposalSchema,
    });
    assertFinished(trace);
    if (drafting && !trace.sawRead) {
      if (attempt === 1) throw new LocalizedError("runner.unreadCodebase");
      input.onActivity?.({ op: "note", text: t("runner.retryProposal", { reason: t("runner.unreadCodebase") }) });
      continue;
    }
    return parseProposal(extractJson(trace.finalText));
  }
  throw new LocalizedError("runner.failed");
}

/** Derives localized form fields without any project or filesystem tools. */
export async function deriveFieldsWithCodex(input: {
  model: string;
  skill: string;
  files: SkillFile[];
  signal: AbortSignal;
  locale?: Locale;
  translate?: Translate;
}): Promise<SkillFields> {
  const trace = await runCodexTurn({
    model: input.model, cwd: os.tmpdir(), signal: input.signal, timeoutMs: 5 * 60_000,
    prompt: buildSkillFieldsPrompt(input), readOnly: true, settingSources: [],
    outputSchema: object({ ziel: { type: "string" }, auftrag: { type: "string" } }),
  });
  assertFinished(trace);
  return readSkillFields(trace.finalText);
}

function assertFinished(trace: AgentTrace): void {
  if (trace.status === "cancelled") {
    const error = new LocalizedError("runner.cancelled");
    error.name = "AbortError";
    throw error;
  }
  if (trace.status !== "finished") {
    if (trace.error) throw new Error(trace.error);
    throw new LocalizedError("runner.failed");
  }
}

function object(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const proposalSchema = object({
  reasoning: { type: "string" },
  edits: { type: "array", items: object({
    op: { type: "string", enum: ["append", "insert_after", "replace", "delete"] },
    content: { type: "string" }, target: { type: "string" }, why: { type: "string" },
  }) },
  files: { type: "array", items: object({
    op: { type: "string", enum: ["write", "replace", "delete"] },
    path: { type: "string" }, content: { type: "string" }, target: { type: "string" },
    why: { type: "string" }, executable: { type: "boolean" },
  }) },
  slow: { type: "string" },
});
