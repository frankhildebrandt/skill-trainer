import { describe, expect, it } from "vitest";
import { restoreSettings } from "./settings";

describe("restoreSettings", () => {
  it("restores the inference provider and keeps older sessions on Cursor", () => {
    expect(restoreSettings({ provider: "codex", targetModel: "codex-model" })).toMatchObject({ provider: { kind: "codex" }, targetModel: "codex-model" });
    expect(restoreSettings({})?.provider?.kind).toBe("cursor");
    expect(restoreSettings({ provider: "unknown" })?.provider?.kind).toBe("cursor");
    expect(restoreSettings({ provider: { kind: "codex" } })?.provider?.kind).toBe("codex");
    expect(restoreSettings({ provider: "codex" })).toMatchObject({ targetModel: "", optimizerModel: "" });
  });
  it("keeps a saved form", () => {
    const form = restoreSettings({
      skillPath: "/tmp/skill",
      workspacePath: "/tmp/project",
      auftrag: "Baue das Modul.",
      extraTasks: "eine Variante",
      verifyMode: "command",
      verifyCommand: "npm test",
      targetModel: "grok-4.7",
      optimizerModel: "grok-4.7",
      steps: 4,
      trainBatch: 4,
      selectionRepeats: 2,
      concurrency: 2,
      learningRate: 3,
      slowUpdate: false,
      gateOnEmptyRepo: true,
      skillScope: "specific",
      attemptTimeoutMin: 12,
      verifyTimeoutSec: 180,
    });
    expect(form?.targetModel).toBe("grok-4.7");
    expect(form?.skillScope).toBe("specific");
    expect(form?.extraTasks).toBe("eine Variante");
    expect(form?.attemptTimeoutMin).toBe(12);
  });

  it("reads an older session request with timeouts in milliseconds", () => {
    const form = restoreSettings({
      skillPath: "/Users/frank/Projects/training/neti-operator-unit",
      workspacePath: "/Users/frank/Projects/training/neti",
      auftrag: "schreibe mir einen operator",
      extraTasks: ["MySQL/MariaDB", "PostgreSQL"],
      verifyMode: "agent",
      verifyCommand: "",
      targetModel: "composer-2.5",
      optimizerModel: "default",
      steps: 2,
      trainBatch: 5,
      selectionRepeats: 2,
      concurrency: 3,
      learningRate: 3,
      slowUpdate: false,
      gateOnEmptyRepo: true,
      attemptTimeoutMs: 720000,
      verifyTimeoutMs: 180000,
    });
    expect(form?.extraTasks).toBe("MySQL/MariaDB\nPostgreSQL");
    expect(form?.verifyMode).toBe("agent");
    expect(form?.attemptTimeoutMin).toBe(12);
    expect(form?.verifyTimeoutSec).toBe(180);
    expect(form?.gateOnEmptyRepo).toBe(true);
    expect(form?.optimizerModel).toBe("default");
  });
});

it("restores workflow, unlimited budgets, and draft-only settings", () => {
  const budget = { unlimited: true, maxEditChars: 50000, maxAddedChars: 200000, maxFileEdits: 30, maxFileChars: 120000 };
  const restored = restoreSettings({ workflow: "create", skillName: "my-skill", skillBrief: "A reusable skill.", trainAfterDraft: false, budget, runBudget: null });
  expect(restored).toMatchObject({ workflow: "create", skillName: "my-skill", skillBrief: "A reusable skill.", trainAfterDraft: false, budget, runBudget: null });
  expect(restoreSettings({})?.budget?.maxFileEdits).toBe(4);
  expect(restoreSettings({})?.runBudget).toBe(48);
});

it("restores provider presets and custom endpoints without retaining inline secrets", () => {
  expect(restoreSettings({})?.provider?.kind).toBe("cursor");
  expect(restoreSettings({ provider: { kind: "ollama" } })?.provider).toEqual({
    kind: "ollama", baseUrl: "http://localhost:11434/v1", apiKeyEnv: "",
  });
  expect(restoreSettings({ provider: { kind: "compatible", baseUrl: "https://example.test/api/v1", apiKeyEnv: "MY_KEY", apiKey: "secret" } })?.provider).toEqual({
    kind: "compatible", baseUrl: "https://example.test/api/v1", apiKeyEnv: "MY_KEY",
  });
});
