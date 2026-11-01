import { translate } from "../shared/i18n";
import { describe, expect, it } from "vitest";
import type { Trajectory } from "../shared/types";
import type { Proposal } from "./json";
import { trainSkill, type AttemptCall, type ProposeCall } from "./loop";
import { DEFAULT_BUDGET } from "../shared/budget";

const MAGIC = "Run `npm test` before editing parsers.";

describe("trainSkill", () => {
  it("keeps an edit only when fresh runs score higher", async () => {
    const proposals: Proposal[] = [
      {
        reasoning: "The failures searched the repo instead of running the test command.",
        slow: null,
        edits: [{ op: "append", target: "", content: MAGIC, why: "skip the search" }],
      },
      {
        reasoning: "Drop the command.",
        slow: null,
        edits: [{ op: "delete", target: MAGIC, content: "" }],
      },
    ];
    const seen: string[] = [];
    const summary = await trainSkill(baseConfig({ slowUpdate: false, steps: 2 }), {
      emit: () => undefined,
      propose: async () => proposals.shift() ?? { reasoning: "", edits: [], slow: null },
      runAttempt: async (input) => {
        seen.push(input.phase);
        return trajectory(input, input.skill.includes(MAGIC));
      },
    });

    expect(summary.error).toBeUndefined();
    expect(summary.bestSkill).toContain(MAGIC);
    expect(summary.best.passes).toBe(2);
    expect(summary.baseline.passes).toBe(0);
    expect(summary.steps.filter((step) => step.accepted)).toHaveLength(1);
    expect(summary.rejected).toHaveLength(1);
    expect(seen.filter((phase) => phase === "gate")).toHaveLength(4);
  });

  it("localizes training and gate messages while preserving generated content", async () => {
    const logs: string[] = [];
    const reasoning = "Run the documented test command.";
    const summary = await trainSkill(baseConfig({ slowUpdate: false, steps: 1 }), {
      translate: (key, values) => translate("fr", key, values),
      emit: (event) => { if (event.type === "log") logs.push(event.message); },
      propose: async () => ({ reasoning, slow: null, edits: [{ op: "append", target: "", content: MAGIC }] }),
      runAttempt: async (input) => trajectory(input, input.skill.includes(MAGIC)),
    });
    expect(logs[0]).toBe("Référence : 2 nouvelles exécutions de la tâche principale.");
    expect(logs.some((message) => message.includes("Étape 1 : validation avec 2 nouvelles exécutions."))).toBe(true);
    expect(logs.some((message) => message.startsWith("Étape 1 acceptée"))).toBe(true);
    expect(summary.bestSkill).toContain(MAGIC);
    expect(summary.steps[1].reasoning).toBe(reasoning);
  });

  it("accepts a slow update only when the held-out score rises", async () => {
    const summary = await trainSkill(baseConfig({ slowUpdate: true, steps: 1 }), {
      emit: () => undefined,
      propose: async (input: ProposeCall) => {
        if (input.kind === "slow") {
          return { reasoning: "Remember the command.", edits: [], slow: "Prefer the documented test command." };
        }
        return {
          reasoning: "Add the command.",
          slow: null,
          edits: [{ op: "append", target: "", content: MAGIC }],
        };
      },
      runAttempt: async (input) => trajectory(input, input.skill.includes(MAGIC), input.skill.includes("documented")),
    });

    expect(summary.bestSkill).toContain("documented");
    expect(summary.steps.some((step) => step.kind === "slow" && step.accepted)).toBe(true);
    expect(summary.best.gate).toBeGreaterThan(summary.baseline.gate);
  });

  it("trains in the project and scores baseline and gate on an empty repository", async () => {
    const grounds: string[] = [];
    let sawEmptyGate = false;
    const summary = await trainSkill(baseConfig({ slowUpdate: false, steps: 1, gateOnEmptyRepo: true }), {
      emit: () => undefined,
      propose: async (input: ProposeCall) => {
        sawEmptyGate = input.emptyGate;
        return {
          reasoning: "Write the scaffold the empty repo still lacks.",
          slow: null,
          edits: [{ op: "append", target: "", content: MAGIC }],
        };
      },
      runAttempt: async (input) => {
        grounds.push(`${input.phase}:${input.ground}`);
        const passed = input.ground === "empty" ? input.skill.includes(MAGIC) : true;
        return trajectory(input, passed);
      },
    });

    expect(sawEmptyGate).toBe(true);
    expect(grounds).toEqual(["baseline:empty", "baseline:empty", "train:repo", "gate:empty", "gate:empty"]);
    expect(summary.bestSkill).toContain(MAGIC);
    expect(summary.baseline.passes).toBe(0);
    expect(summary.best.passes).toBe(2);
  });

  it("accepts an edit to a helper file in the skill folder", async () => {
    const summary = await trainSkill(
      {
        ...baseConfig({ slowUpdate: false, steps: 1 }),
        files: [
          { path: "SKILL.md", text: "---\nname: demo\n---\n\n# Demo\n\nLook around.\n" },
          { path: "scripts/run.py", text: "print('old')\n" },
        ],
      },
      {
        emit: () => undefined,
        propose: async () => ({
          reasoning: "The helper still prints the old line.",
          slow: null,
          edits: [],
          files: [{ op: "replace", path: "scripts/run.py", target: "print('old')", content: "print('helper')" }],
        }),
        runAttempt: async (input) => {
          const script = input.files.find((file) => file.path === "scripts/run.py")?.text ?? "";
          return trajectory(input, script.includes("helper"));
        },
      },
    );

    expect(summary.bestFiles?.find((file) => file.path === "scripts/run.py")?.text).toContain("helper");
    expect(summary.steps.some((step) => step.accepted)).toBe(true);
    expect(summary.baseline.passes).toBe(0);
  });

  it("does not spend a gate when no edit applies", async () => {
    let gates = 0;
    await trainSkill(baseConfig({ slowUpdate: false, steps: 1 }), {
      emit: () => undefined,
      propose: async () => ({ reasoning: "nothing", edits: [], slow: null }),
      runAttempt: async (input) => {
        if (input.phase === "gate") gates += 1;
        return trajectory(input, false);
      },
    });
    expect(gates).toBe(0);
  });

  it("carries unlimited document and file edits through the measured gate", async () => {
    const summary = await trainSkill({
      ...baseConfig({ slowUpdate: false, steps: 1 }),
      learningRate: 1,
      budget: { ...DEFAULT_BUDGET, unlimited: true },
      files: [{ path: "obsolete.md", text: "old" }],
    }, {
      emit: () => undefined,
      propose: async (input) => {
        expect(input.budget?.unlimited).toBe(true);
        return { reasoning: "Rebuild all references.", slow: null,
          edits: Array.from({ length: 7 }, (_, i) => ({ op: "append" as const, target: "", content: `${i}: ${"procedure ".repeat(300)}` })),
          files: [{ op: "delete" as const, path: "obsolete.md", content: "" }, ...Array.from({ length: 6 }, (_, i) => ({ op: "write" as const, path: `references/${i}.md`, content: "reference ".repeat(1500) }))],
        };
      },
      runAttempt: async (input) => trajectory(input,
        input.skill.includes("6: procedure") && input.files.filter((file) => file.path.startsWith("references/")).length === 6 && !input.files.some((file) => file.path === "obsolete.md")),
    });
    expect(summary.error).toBeUndefined();
    expect(summary.best.passes).toBe(2);
    expect(summary.steps[1].applied).toHaveLength(7);
    expect(summary.steps[1].appliedFiles).toHaveLength(7);
  });
});

function baseConfig(overrides: { slowUpdate: boolean; steps: number; gateOnEmptyRepo?: boolean }) {
  return {
    skill: "---\nname: demo\n---\n\n# Demo\n\nLook around.\n",
    auftrag: "Make the parser accept empty files.",
    extraTasks: [],
    targetModel: "composer-2.5",
    steps: overrides.steps,
    trainBatch: 1,
    selectionRepeats: 2,
    concurrency: 2,
    learningRate: 2,
    slowUpdate: overrides.slowUpdate,
    gateOnEmptyRepo: overrides.gateOnEmptyRepo ?? false,
    signal: new AbortController().signal,
    sessionDir: "memory",
  };
}

function trajectory(input: AttemptCall, passed: boolean, lean = false): Trajectory {
  const toolCalls = passed ? (lean ? 1 : 8) : 16;
  const hard = passed ? 1 : 0;
  const soft = passed ? 1 / (1 + toolCalls / 8) : 0;
  return {
    runId: `${input.phase}-${input.taskPrompt.length}-${input.ground}`,
    phase: input.phase,
    ground: input.ground,
    taskPrompt: input.taskPrompt,
    score: {
      hard,
      soft,
      gate: 0.85 * hard + 0.15 * soft,
      verifyExitCode: passed ? 0 : 1,
      verifyOutput: passed ? "ok" : "fail",
      toolCalls,
      durationMs: 10,
      status: "finished",
    },
    summary: passed ? "passed" : "failed by searching",
    diffStat: "",
    keptWorkspace: null,
  };
}
