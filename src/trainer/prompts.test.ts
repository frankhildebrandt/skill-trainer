import { describe, expect, it } from "vitest";
import type { Trajectory } from "../shared/types";
import { buildOptimizerPrompt } from "./prompts";

const base = { skill: "# Skill\n", kind: "step" as const, learningRate: 1, train: [], rejected: [] };

describe("buildOptimizerPrompt", () => {
  it("keeps a general skill reusable and lets a tailored skill name this assignment", () => {
    expect(buildOptimizerPrompt({ ...base, skillScope: "general" })).toContain("must stay general");
    const specific = buildOptimizerPrompt({
      ...base,
      skillScope: "specific",
      auftrag: "Schreibe die Ping-Unit für 10.0.0.8.",
    });
    expect(specific).toContain("this assignment");
    expect(specific).toContain("10.0.0.8");
    expect(specific).not.toContain("must stay general");
  });

  it("hides deleted run paths so the optimizer does not go looking for them", () => {
    const run: Trajectory = {
      runId: "train-3",
      phase: "train",
      ground: "repo",
      taskPrompt: "auftrag",
      score: {
        hard: 1,
        soft: 1,
        gate: 1,
        verifyExitCode: 0,
        verifyOutput: "",
        toolCalls: 2,
        durationMs: 1000,
        status: "finished",
      },
      summary:
        "missing /Users/frank/Library/Application Support/skill-trainer/sessions/2026-11-01T09-03-46-039Z/runs/train-3/workspace",
      diffStat: "",
      keptWorkspace: null,
    };
    const prompt = buildOptimizerPrompt({ ...base, train: [run] });
    expect(prompt).toContain("Do not search the disk");
    expect(prompt).not.toContain("/Users/frank");
    expect(prompt).not.toContain("skill-trainer/sessions");
    expect(prompt).toContain("[path]");
  });
});
