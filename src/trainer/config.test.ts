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
