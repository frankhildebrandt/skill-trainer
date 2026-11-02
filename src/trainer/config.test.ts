import { describe, expect, it } from "vitest";
import { normalizeRequest } from "./config";
import type { TrainRequest } from "../shared/types";

function request(overrides: Partial<TrainRequest> = {}): TrainRequest {
  return {
    skillPath: "/tmp/skill",
    workspacePath: "/tmp/project",
    auftrag: "Baue das Modul.",
    extraTasks: "",
    verifyMode: "command",
    verifyCommand: "npm test",
    targetModel: "composer-2.5",
    optimizerModel: "composer-2.5",
    steps: 1,
    trainBatch: 1,
    selectionRepeats: 1,
    concurrency: 1,
    learningRate: 1,
    slowUpdate: false,
    gateOnEmptyRepo: false,
    skillScope: "general",
    attemptTimeoutMin: 12,
    verifyTimeoutSec: 180,
    ...overrides,
  };
}

describe("normalizeRequest", () => {
  it("selects Codex explicitly and keeps existing sessions on Cursor", () => {
    expect(normalizeRequest(request()).provider.kind).toBe("cursor");
    expect(normalizeRequest(request({ provider: { kind: "codex" }, targetModel: "codex-model" })).provider.kind).toBe("codex");
    expect(normalizeRequest(request({ provider: { kind: "ollama" }, targetModel: "local-model" })).provider.kind).toBe("ollama");
    expect(() => normalizeRequest(request({ provider: "unknown" as never }), "en")).toThrow("Unknown inference provider.");
  });
  it("accepts an agent-written check without a user command", () => {
    const config = normalizeRequest(request({ verifyMode: "agent", verifyCommand: "" }));
    expect(config.verifyMode).toBe("agent");
    expect(config.verifyCommand).toBe("");
  });

  it("keeps a missing scope general and accepts a tailored skill", () => {
    expect(normalizeRequest({ ...request(), skillScope: undefined }).skillScope).toBe("general");
    expect(normalizeRequest(request({ skillScope: "specific" })).skillScope).toBe("specific");
  });

  it("still requires a command when the user grades with their own", () => {
    expect(() => normalizeRequest(request({ verifyMode: "command", verifyCommand: "  " }))).toThrow(/Prüfbefehl/);
  });
});

it("accepts larger training schedules when the run budget is raised or removed", () => {
  const larger = request({ steps: 10, trainBatch: 8, selectionRepeats: 5, learningRate: 12 });
  expect(() => normalizeRequest(larger)).toThrow(/Laufbudget/);
  expect(normalizeRequest({ ...larger, runBudget: 200 }).steps).toBe(10);
  expect(normalizeRequest({ ...larger, runBudget: null }).runBudget).toBeNull();
});

it("counts optimizer and check-author calls in the scheduled run budget", () => {
  expect(() => normalizeRequest(request({ runBudget: 3, verifyMode: "agent" }))).toThrow(/5 Agent-Läufe/);
});

it("requires a project for standalone create and pretraining, but not a test command", () => {
  const draft = request({ workflow: "create", skillName: "new-skill", skillBrief: "Create a reusable helper.", trainAfterDraft: false, workspacePath: "", auftrag: "", verifyCommand: "" });
  expect(() => normalizeRequest(draft)).toThrow(/Projektordner/);
  const ready = normalizeRequest({ ...draft, workspacePath: "/tmp/project" });
  expect(ready.workflow).toBe("create");
  expect(ready.workspacePath).toBe("/tmp/project");
  expect(normalizeRequest({ ...draft, workflow: "pretrain", workspacePath: "/tmp/project" }).trainAfterDraft).toBe(false);
  expect(() => normalizeRequest({ ...draft, trainAfterDraft: true, workspacePath: "/tmp/project" })).toThrow(/Auftrag fehlt/);
  expect(() => normalizeRequest({ ...draft, skillName: "../escape", workspacePath: "/tmp/project" })).toThrow(/Skill-Name/);
  expect(() => normalizeRequest({ ...draft, skillBrief: "", workspacePath: "/tmp/project" })).toThrow(/Beschreibe/);
});

it("preserves explicit edit budgets and rejects invalid numeric limits", () => {
  const budget = { unlimited: true, maxEditChars: 50000, maxAddedChars: 200000, maxFileEdits: 30, maxFileChars: 120000 };
  expect(normalizeRequest(request({ budget })).budget).toEqual(budget);
  expect(() => normalizeRequest(request({ budget: { ...budget, maxFileEdits: 0 } }))).toThrow(/Datei-Edits/);
  expect(() => normalizeRequest(request({ steps: 1.5 }))).toThrow(/ganze Zahl/);
});


it("localizes validation messages and numeric field labels", () => {
  expect(() => normalizeRequest(request({ steps: 0 }), "fr")).toThrow("Étapes : la valeur doit être un entier positif.");
  expect(() => normalizeRequest(request({ workspacePath: "" }), "nl")).toThrow("Kies de projectmap.");
  expect(() => normalizeRequest(request({ runBudget: 3, verifyMode: "agent" }), "en")).toThrow("up to 5 agent runs");
});
