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

  it("describes the configured budget and allows complete folder changes", () => {
    const prompt = buildOptimizerPrompt({ ...base, learningRate: 9, budget: {
      unlimited: false, maxEditChars: 8000, maxAddedChars: 16000, maxFileEdits: 12, maxFileChars: 25000,
    } });
    expect(prompt).toContain("at most 9 text edits");
    expect(prompt).toContain("8000 characters");
    expect(prompt).toContain("16000 added characters");
    expect(prompt).toContain("12 file operations");
    expect(prompt).toContain("25000 characters");
    expect(prompt).toContain("SKILL.md can be rewritten");
    expect(prompt).toContain("delete: \"path\" identifies an obsolete companion file");
    expect(prompt).not.toContain("Do not change the name field");
  });

  it("removes optimizer budget limits and includes every complete reference", () => {
    const marker = "LAST REFERENCE END";
    const files = Array.from({ length: 15 }, (_, index) => ({ path: `references/${index}.md`, text: `${"x".repeat(2200)}\n${index === 14 ? marker : index}` }));
    const prompt = buildOptimizerPrompt({ ...base, files, budget: {
      unlimited: true, maxEditChars: 1800, maxAddedChars: 2500, maxFileEdits: 4, maxFileChars: 12000,
    } });
    expect(prompt).toContain("no harness limit on the number of edits");
    expect(prompt).not.toContain("at most 1 text edits");
    expect(prompt).toContain(marker);
    expect(prompt).toContain("x".repeat(2200));
  });

  it("supports creating and pretraining skills from a brief before rollouts exist", () => {
    const create = buildOptimizerPrompt({ ...base, kind: "create", skillBrief: "Create a release skill with a validation script." });
    expect(create).toContain("Create a new skill folder");
    expect(create).toContain("only after you have read the repository");
    expect(create).toContain("Before you design the skill, read that codebase");
    expect(create).not.toContain("Do not call tools");
    expect(create).toContain("Write the complete SKILL.md");
    expect(create).toContain("Create a release skill with a validation script.");
    expect(create).toContain("There are no rollout results yet");
    const pretrain = buildOptimizerPrompt({ ...base, kind: "pretrain", skillBrief: "Replace outdated references." });
    expect(pretrain).toContain("pretraining before fine-tuning");
    expect(pretrain).toContain("Only after you have read the repository");
    expect(pretrain).toContain("Before you design the skill, read that codebase");
    expect(pretrain).not.toContain("Do not call tools");
    expect(pretrain).toContain("Replace outdated references.");
    expect(buildOptimizerPrompt(base)).toContain("Do not call tools");
  });
});
