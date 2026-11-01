import { describe, expect, it } from "vitest";
import { restoreSettings } from "./settings";

describe("restoreSettings", () => {
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
