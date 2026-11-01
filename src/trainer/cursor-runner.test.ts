import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate, type Locale, type Translate } from "../shared/i18n";
import { LocalizedError, localizedMessage } from "../shared/localized-error";
import type { ActivityUpdate } from "../shared/run-log";
import type { ProposeCall } from "./loop";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  store: vi.fn(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("@cursor/sdk", () => ({
  Agent: { create: mocks.create },
  CursorAgentError: class extends Error {},
  JsonlLocalAgentStore: class {
    constructor(directory: string) { mocks.store(directory); }
  },
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: mocks.mkdir, mkdtemp: mocks.mkdtemp, rm: mocks.rm },
}));

import { deriveSkillFields, proposeWithCursor } from "./cursor-runner";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.mkdtemp.mockResolvedValue("/virtual/skill-trainer-opt-call");
  mocks.rm.mockResolvedValue(undefined);
});

interface RunOptions {
  chunks?: string[];
  events?: unknown[];
  result?: string;
  status?: "finished" | "cancelled" | "error";
  error?: string;
  streamError?: Error;
}

function run({ chunks = [], events, result = "", status = "finished", error, streamError }: RunOptions = {}) {
  return {
    stream: vi.fn(async function* () {
      if (events) {
        for (const event of events) yield event;
      } else {
        for (const text of chunks) yield { type: "assistant", message: { content: [{ type: "text", text }] } };
      }
      if (streamError) throw streamError;
    }),
    supports: vi.fn((feature: string) => feature === "cancel"),
    cancel: vi.fn(),
    wait: vi.fn(async () => ({ status, result, ...(error ? { error: { message: error } } : {}) })),
  };
}

function agent(...runs: Array<ReturnType<typeof run>>) {
  const send = vi.fn();
  for (const next of runs) send.mockResolvedValueOnce(next);
  return { send, [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) };
}

function t(locale: Locale): Translate {
  return (key, values) => translate(locale, key, values);
}

function proposalInput(extra: Partial<ProposeCall> & { translate?: Translate; onActivity?: (update: ActivityUpdate) => void } = {}): ProposeCall & {
  model: string;
  cwd: string;
  translate?: Translate;
  onActivity?: (update: ActivityUpdate) => void;
} {
  return {
    skill: "# Existing skill", files: [{ path: "SKILL.md", text: "# Existing skill" }],
    kind: "step", learningRate: 1, train: [], rejected: [], emptyGate: false, skillScope: "general",
    auftrag: "Keep the user assignment unchanged.", signal: new AbortController().signal,
    model: "selected-optimizer", cwd: "/virtual/session", ...extra,
  };
}

const proposal = { reasoning: "Keep this original reasoning: Überprüfung.", edits: [{ op: "append", content: "Run résumé.sh {count}." }], slow: null };
const proposalJson = JSON.stringify(proposal);

describe("localized model completions", () => {
  it.each<[Locale, string]>([
    ["de", "German"], ["en", "English"], ["fr", "French"],
    ["it", "Italian"], ["es", "Spanish"], ["nl", "Dutch"],
  ])("requests %s field content with the chosen model and preserves its generated values", async (locale, language) => {
    const fields = { ziel: "Original goal: déjà vu {count} $&", auftrag: "Original task: parse résumé.csv." };
    const reply = JSON.stringify(fields);
    const completion = run({ chunks: [reply.slice(0, 25), reply.slice(25)], status: "cancelled" });
    const model = agent(completion);
    mocks.create.mockResolvedValue(model);

    await expect(deriveSkillFields({
      model: "selected-analysis-model", skill: "# Original skill\nAnweisung unverändert.",
      files: [{ path: "references/example.md", text: "Unchanged companion text." }],
      locale, signal: new AbortController().signal,
    })).resolves.toEqual(fields);

    const prompt = model.send.mock.calls[0][0] as string;
    expect(prompt).toContain(`in plain ${language}`);
    expect(prompt).toContain(`one concrete assignment, in ${language},`);
    expect(prompt).toContain("Anweisung unverändert.");
    expect(prompt).toContain("Unchanged companion text.");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: { id: "selected-analysis-model" }, tools: [], local: expect.objectContaining({ settingSources: [] }),
    }));
    expect(model.send).toHaveBeenCalledTimes(1);
    expect(completion.cancel).toHaveBeenCalledTimes(1);
    expect(model[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(mocks.rm).toHaveBeenCalledWith("/virtual/skill-trainer-opt-call", { recursive: true, force: true });
  });

  it("reads the project with read-only tools before a create or pretrain proposal", async () => {
    const completion = run({
      status: "cancelled",
      events: [
        { type: "tool_call", name: "read", status: "completed", call_id: "read-1", args: { path: "src/app.ts" }, result: "export {}" },
        { type: "assistant", message: { content: [{ type: "text", text: proposalJson }] } },
      ],
    });
    const model = agent(completion);
    mocks.create.mockResolvedValue(model);

    await proposeWithCursor(proposalInput({ kind: "create", workspacePath: "/virtual/project" }));

    const prompt = model.send.mock.calls[0][0] as string;
    expect(prompt).toContain("Before you design the skill, read that codebase");
    expect(prompt).toContain("Read the repository before you answer");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      tools: ["read", "grep", "glob", "ls", "semSearch"],
      local: expect.objectContaining({ cwd: "/virtual/project", settingSources: [] }),
    }));
    expect(model.send).toHaveBeenCalledTimes(1);
    expect(completion.cancel).toHaveBeenCalledTimes(1);
  });

  it("asks again when a draft is proposed before the codebase was read", async () => {
    const skipped = run({ chunks: [proposalJson] });
    const read = run({
      status: "cancelled",
      events: [
        { type: "tool_call", name: "grep", status: "completed", call_id: "grep-1", args: { pattern: "export" }, result: "src/app.ts" },
        { type: "assistant", message: { content: [{ type: "text", text: proposalJson }] } },
      ],
    });
    const model = agent(skipped, read);
    mocks.create.mockResolvedValue(model);
    const updates: ActivityUpdate[] = [];

    const result = await proposeWithCursor(proposalInput({
      kind: "pretrain", workspacePath: "/virtual/project", translate: t("de"), onActivity: (update) => updates.push(update),
    }));

    expect(result.reasoning).toBe(proposal.reasoning);
    expect(model.send).toHaveBeenCalledTimes(2);
    expect(model.send.mock.calls[1][0]).toContain("You have not read the repository");
    expect(updates).toContainEqual({ op: "note", text: "Zweiter Versuch im selben Lauf. Die Codebase wurde noch nicht gelesen." });
    expect(skipped.cancel).not.toHaveBeenCalled();
    expect(read.cancel).toHaveBeenCalledTimes(1);
  });

  it("localizes optimizer retry and completion notes through the supplied translator", async () => {
    const first = run({ result: "The response is not JSON." });
    const second = run({ chunks: [proposalJson], status: "cancelled" });
    const model = agent(first, second);
    mocks.create.mockResolvedValue(model);
    const updates: ActivityUpdate[] = [];

    const result = await proposeWithCursor(proposalInput({ translate: t("fr"), onActivity: (update) => updates.push(update) }));

    expect(updates.filter((update) => update.op === "note")).toEqual([
      { op: "note", text: "Deuxième tentative dans la même exécution. La réponse de l’optimiseur ne contient pas d’objet JSON complet." },
      { op: "note", text: "La proposition est complète. Cette exécution s’arrête ici pour éviter un nouveau raisonnement dans la même exécution." },
    ]);
    expect(result.reasoning).toBe(proposal.reasoning);
    expect(result.edits[0].content).toBe(proposal.edits[0].content);
    expect(model.send).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      local: expect.objectContaining({ cwd: "/virtual/skill-trainer-opt-call", settingSources: [] }),
    }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(second.cancel).toHaveBeenCalledTimes(1);
    expect(model[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("localizes the connection retry while disposing the stalled SDK run", async () => {
    const stalled = agent(run({ streamError: new Error("SDK transport stalled") }));
    const completed = agent(run({ chunks: [proposalJson], status: "cancelled" }));
    mocks.create.mockResolvedValueOnce(stalled).mockResolvedValueOnce(completed);
    const updates: ActivityUpdate[] = [];

    const result = await proposeWithCursor(proposalInput({ translate: t("nl"), onActivity: (update) => updates.push(update) }));

    expect(updates).toContainEqual({ op: "note", text: "Verbinding vastgelopen. Opnieuw proberen." });
    expect(result.reasoning).toBe(proposal.reasoning);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(stalled[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(completed[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("classifies a cancelled analysis using its analysis-specific diagnostic key", async () => {
    const completion = run({ status: "cancelled" });
    const model = agent(completion);
    mocks.create.mockResolvedValue(model);

    const error = await deriveSkillFields({
      model: "selected-analysis-model", skill: "# Skill", files: [], locale: "fr", signal: new AbortController().signal,
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(LocalizedError);
    expect(error).toMatchObject({ key: "runner.analysisCancelled", name: "AbortError" });
    expect(localizedMessage(error, t("fr"))).toBe("Analyse annulée");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(model[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("preserves SDK failure messages instead of replacing them with localized fallback text", async () => {
    const diagnostic = "SDK HTTP 429: quota déjà épuisé {count}.";
    const model = agent(run({ status: "error", error: diagnostic }));
    mocks.create.mockResolvedValue(model);

    const error = await deriveSkillFields({
      model: "selected-analysis-model", skill: "# Skill", files: [], locale: "nl", signal: new AbortController().signal,
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LocalizedError);
    expect(localizedMessage(error, t("nl"))).toBe(diagnostic);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(model[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("uses the analysis failure diagnostic when the SDK supplies no message", async () => {
    const model = agent(run({ status: "error" }));
    mocks.create.mockResolvedValue(model);

    const error = await deriveSkillFields({
      model: "selected-analysis-model", skill: "# Skill", files: [], locale: "it", signal: new AbortController().signal,
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(LocalizedError);
    expect(error).toMatchObject({ key: "runner.analysisFailed" });
    expect(localizedMessage(error, t("it"))).toBe("L’analisi è fallita.");
    expect(model[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });
});
