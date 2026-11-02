import type { ProviderConfig } from "../shared/provider";
import { executeCompatibleAgent } from "./openai-runner";
import { translate, type Translate, type Locale, type TranslationKey } from "../shared/i18n";
import { LocalizedError, localizedMessage } from "../shared/localized-error";
import { Agent, CursorAgentError, JsonlLocalAgentStore, type SDKMessage } from "@cursor/sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentTrace, ExecuteRequest } from "./attempt";
import type { ActivityUpdate } from "../shared/run-log";
import type { SkillFile } from "../shared/types";
import { createActivitySink, describeSdkEvent, type ActivityEvent } from "./activity";
import { extractJson, parseProposal, type Proposal } from "./json";
import type { ProposeCall } from "./loop";
import { buildOptimizerPrompt } from "./prompts";
import { isAbortError } from "./pool";
import { buildSkillFieldsPrompt, hasSkillFields, readSkillFields, type SkillFields } from "./skill-fields";

export function isStartupError(err: unknown): boolean {
  return err instanceof CursorAgentError;
}

export async function executeAgent(input: ExecuteRequest): Promise<AgentTrace> {
  if (input.provider && input.provider.kind !== "cursor") return executeCompatibleAgent({ ...input, provider: input.provider });
  const started = Date.now();
  const agent = await Agent.create({
    model: { id: input.model },
    local: {
      cwd: input.cwd,
      settingSources: input.settingSources ?? ["project"],
      store: await agentStore(input.cwd),
      ...(input.fs ? { fs: input.fs } : {}),
    },
  });

  try {
    const run = await agent.send(input.prompt);
    const cancel = () => {
      if (run.supports("cancel")) void run.cancel();
    };
    if (input.signal.aborted) cancel();
    else input.signal.addEventListener("abort", cancel, { once: true });

    const notes: string[] = [];
    let toolCalls = 0;
    try {
      toolCalls = await followStream(run, notes, input.onActivity);
    } catch (err) {
      if (!isAbortError(err) && !input.signal.aborted) {
        notes.push(`stream: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const result = await run.wait();
    input.signal.removeEventListener("abort", cancel);

    if (toolCalls === 0 && run.supports("conversation")) {
      try {
        const walked = walkConversation(await run.conversation());
        toolCalls = walked.tools;
        if (notes.length === 0) notes.push(walked.text);
      } catch {
        // The score still has the verify result when the transcript is unavailable.
      }
    }

    const status = result.status === "finished" || result.status === "cancelled" ? result.status : "error";
    return {
      status,
      finalText: clip(result.result ?? "", 4000),
      toolCalls,
      transcript: clip(notes.join("\n"), 8000),
      durationMs: result.durationMs ?? Date.now() - started,
      error: result.error?.message,
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

export async function proposeWithCursor(
  input: ProposeCall & { provider?: ProviderConfig; model: string; cwd: string; onActivity?: (update: ActivityUpdate) => void; translate?: Translate },
): Promise<Proposal> {
  const t: Translate = input.translate ?? ((key, values) => translate("de", key, values));
  const prompt = buildOptimizerPrompt(input);
  const drafting = input.kind === "create" || input.kind === "pretrain";
  if (drafting && !input.workspacePath?.trim()) throw new LocalizedError("trainer.chooseProject");
  const text = await completeText(input.model, input.cwd, prompt, input.signal, input.onActivity, t, {
    provider: input.provider,
    inspectDir: drafting ? input.workspacePath : undefined,
  });
  return parseProposal(extractJson(text));
}

/** Reads the selected skill with the chosen model and returns localized form fields. */
export async function deriveSkillFields(input: {
  provider?: ProviderConfig;
  model: string;
  skill: string;
  files: SkillFile[];
  signal: AbortSignal;
  locale?: Locale;
  translate?: Translate;
}): Promise<SkillFields> {
  const t: Translate = input.translate ?? ((key, values) => translate(input.locale ?? "de", key, values));
  const prompt = buildSkillFieldsPrompt({ skill: input.skill, files: input.files, locale: input.locale });
  const text = await completeText(input.model, os.tmpdir(), prompt, input.signal, undefined, t, {
    provider: input.provider,
    accept: hasSkillFields,
    problem: (reply) => skillFieldsProblem(reply, t),
    abortKey: "runner.analysisCancelled",
    failureKey: "runner.analysisFailed",
  });
  return readSkillFields(text);
}

export async function makeOptimizerDir(sessionDir: string): Promise<string> {
  const root = path.join(sessionDir, "optimizer");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, "call-"));
}

const READ_TOOLS = ["read", "grep", "glob", "ls", "semSearch"] as const;

interface CompleteOptions {
  provider?: ProviderConfig;
  accept?: (text: string) => boolean;
  problem?: (text: string) => string;
  abortKey?: TranslationKey;
  failureKey?: TranslationKey;
  /** Project the agent must read before it answers. Read tools only. */
  inspectDir?: string;
}

async function completeText(
  model: string,
  cwd: string,
  prompt: string,
  signal: AbortSignal,
  onActivity: ((update: ActivityUpdate) => void) | undefined,
  t: Translate,
  options: CompleteOptions = {},
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-trainer-opt-"));
  await fs.mkdir(dir, { recursive: true });
  try {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await completeTextOnce(model, dir, cwd, prompt, signal, onActivity, t, options);
      } catch (err) {
        last = err;
        if (attempt === 1 || signal.aborted || isAbortError(err) || !isStall(err)) throw err;
        onActivity?.({ op: "note", text: t("runner.retryConnection") });
      }
    }
    throw last;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function completeTextOnce(
  model: string,
  dir: string,
  storeCwd: string,
  prompt: string,
  signal: AbortSignal,
  onActivity: ((update: ActivityUpdate) => void) | undefined,
  t: Translate,
  options: CompleteOptions = {},
): Promise<string> {
  const accept = options.accept ?? isProposal;
  const problem = options.problem ?? ((text: string) => proposalProblem(text, t));
  const inspectDir = options.inspectDir?.trim();
  if (options.provider && options.provider.kind !== "cursor") {
    let text = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await executeCompatibleAgent({
        provider: options.provider, model, cwd: inspectDir || dir,
        prompt: `${prompt}\n\n${inspectDir ? "Read the repository with file tools before answering. " : ""}Reply with the JSON object only.${attempt ? " Ensure the JSON is complete and matches the requested schema." : ""}`,
        signal, timeoutMs: 12 * 60_000, onActivity, readOnly: true, noTools: !inspectDir,
      });
      if (result.status === "cancelled") {
        const error = new LocalizedError(options.abortKey ?? "runner.cancelled");
        error.name = "AbortError";
        throw error;
      }
      text = result.finalText;
      if (inspectDir && result.toolCalls === 0) {
        if (attempt === 1) throw new LocalizedError("runner.unreadCodebase");
        continue;
      }
      if (accept(text)) return text;
    }
    return text;
  }
  const agent = await Agent.create({
    model: { id: model },
    tools: inspectDir ? [...READ_TOOLS] : [],
    local: { cwd: inspectDir || dir, settingSources: [], store: await agentStore(path.join(storeCwd, "hold")) },
  });
  try {
    const closing = inspectDir
      ? "Read the repository before you answer. Then reply with the JSON object only."
      : "Reply with the JSON object only.";
    const first = await sendOnce(agent, `${prompt}\n\n${closing}`, signal, onActivity, t, options);
    if (inspectDir && !first.sawTool) {
      onActivity?.({ op: "note", text: t("runner.retryProposal", { reason: t("runner.unreadCodebase") }) });
      const reread = await sendOnce(
        agent,
        "You have not read the repository. Read it with the file tools now. Then reply with the JSON object only.",
        signal,
        onActivity,
        t,
        options,
      );
      if (!reread.sawTool) throw new LocalizedError("runner.unreadCodebase");
      return reread.text;
    }
    if (accept(first.text)) return first.text;
    onActivity?.({ op: "note", text: t("runner.retryProposal", { reason: problem(first.text) }) });
    return (await sendOnce(
      agent,
      "Your previous reply was not one JSON object. Reply with that JSON object only. Do not restate the analysis.",
      signal,
      onActivity,
      t,
      options,
    )).text;
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

async function sendOnce(
  agent: { send: (message: string) => Promise<{ stream: () => AsyncIterable<SDKMessage>; supports: (feature: "cancel") => boolean; cancel: () => Promise<void> | void; wait: () => Promise<{ status: string; result?: string; error?: { message?: string } }> }> },
  prompt: string,
  signal: AbortSignal,
  onActivity: ((update: ActivityUpdate) => void) | undefined,
  t: Translate,
  options: CompleteOptions = {},
): Promise<{ text: string; sawTool: boolean }> {
  const accept = options.accept ?? isProposal;
  const run = await agent.send(prompt);
  const cancel = () => {
    if (run.supports("cancel")) void run.cancel();
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  let assistant = "";
  let proposal: string | null = null;
  let sawTool = false;
  const watch = (update: ActivityUpdate) => {
    onActivity?.(update);
    if (update.op === "tool" && update.status !== "running") sawTool = true;
    if (update.op === "append" && update.kind === "text") assistant += update.text;
    if (proposal || (update.op !== "append" && update.op !== "tool")) return;
    if (update.op === "append" && update.kind !== "text") return;
    if (!accept(assistant)) return;
    if (options.inspectDir && !sawTool) return;
    proposal = assistant;
    onActivity?.({ op: "note", text: t("runner.proposalComplete") });
    if (!signal.aborted) cancel();
  };
  try {
    await followStream(run, [], watch);
  } catch (err) {
    if (proposal) {
      // The turn was stopped because the proposal was already complete.
    } else if (isAbortError(err) || signal.aborted || isStall(err)) throw err;
    else onActivity?.({ op: "note", text: localizedMessage(err, t) });
  }
  const result = await run.wait();
  signal.removeEventListener("abort", cancel);
  if (proposal) return { text: proposal, sawTool };
  if (result.status === "cancelled") {
    const error = new LocalizedError(options.abortKey ?? "runner.cancelled");
    error.name = "AbortError";
    throw error;
  }
  if (result.status === "error") {
    throw result.error?.message ? new Error(result.error.message) : new LocalizedError(options.failureKey ?? "runner.failed");
  }
  return { text: result.result ?? assistant, sawTool };
}

function skillFieldsProblem(text: string, t: Translate): string {
  try {
    readSkillFields(text);
    return t("runner.noFields");
  } catch (err) {
    return err instanceof Error ? localizedMessage(err, t) : t("runner.invalidFields");
  }
}

function proposalProblem(text: string, t: Translate): string {
  try {
    parseProposal(extractJson(text));
    return t("runner.noUsableProposal");
  } catch (err) {
    return err instanceof Error ? localizedMessage(err, t) : t("runner.notProposal");
  }
}

function isProposal(text: string): boolean {
  try {
    parseProposal(extractJson(text));
    return true;
  } catch {
    return false;
  }
}

async function followStream(
  run: { stream: () => AsyncIterable<SDKMessage> },
  notes: string[],
  onActivity?: (update: ActivityUpdate) => void,
): Promise<number> {
  let toolCalls = 0;
  const sink = createActivitySink((update) => {
    onActivity?.(update);
    if (notes.length >= 80) return;
    if (update.op === "tool" && update.status === "running") notes.push(clip(`${update.name} ${update.detail}`.trim(), 500));
    if (update.op === "note") notes.push(clip(update.text, 500));
  });
  try {
    for await (const event of run.stream()) {
      const described = describeSdkEvent(toActivityEvent(event));
      if (!described) continue;
      if (described.kind === "thinking") sink.thinking(described.text);
      else if (described.kind === "text") sink.text(described.text);
      else if (described.kind === "tool") {
        if (described.status !== "running") toolCalls += 1;
        sink.tool({
          callId: described.callId,
          name: described.name,
          status: described.status,
          detail: described.detail,
          output: described.output,
        });
      }
    }
  } finally {
    sink.end();
  }
  return toolCalls;
}

function toActivityEvent(event: SDKMessage): ActivityEvent {
  if (event.type === "thinking") return { type: "thinking", text: event.text };
  if (event.type === "assistant") {
    return {
      type: "assistant",
      message: {
        content: event.message.content.map((block) =>
          block.type === "text" ? { type: "text", text: block.text } : { type: block.type },
        ),
      },
    };
  }
  if (event.type === "tool_call") {
    const callId = "call_id" in event && typeof event.call_id === "string" ? event.call_id : event.name;
    return {
      type: "tool_call",
      name: event.name,
      status: event.status,
      callId,
      args: event.args,
      result: "result" in event ? event.result : undefined,
    };
  }
  return { type: event.type };
}

function isStall(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /stall/i.test(message);
}

async function agentStore(cwd: string): Promise<JsonlLocalAgentStore> {
  const root = path.join(cwd, "..", "agent-store");
  await fs.mkdir(root, { recursive: true });
  return new JsonlLocalAgentStore(root);
}

function walkConversation(value: unknown): { tools: number; text: string } {
  const acc = { tools: 0, parts: [] as string[] };
  visit(value, acc, 0);
  return { tools: acc.tools, text: clip(acc.parts.join("\n"), 8000) };
}

function visit(value: unknown, acc: { tools: number; parts: string[] }, depth: number): void {
  if (depth > 8 || acc.parts.join("").length > 8000) return;
  if (typeof value === "string") {
    if (value.trim()) acc.parts.push(value.slice(0, 500));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, acc, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type.includes("tool") || type === "shell") {
    acc.tools += 1;
    if (typeof record.name === "string") acc.parts.push(`tool ${record.name}`);
  }
  for (const key of ["text", "result", "message", "steps", "content", "turn", "command"]) {
    if (key in record) visit(record[key], acc, depth + 1);
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
