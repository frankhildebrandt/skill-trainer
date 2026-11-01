import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BUDGET } from "../shared/budget";
import type { TrainRequest } from "../shared/types";
import { normalizeRequest } from "./config";
import { prepareSkillDraft } from "./draft";
import type { Proposal } from "./json";
import { trainSkill } from "./loop";

const document = "---\nname: parser-helper\ndescription: Handle parser tasks.\n---\n\n# Parser\nUse the helper.\n";
const request: TrainRequest = {
  workflow: "create", skillName: "parser-helper", skillBrief: "Build a parser helper with executable scripts.",
  trainAfterDraft: false, skillPath: "/tmp/new-skill", workspacePath: "", auftrag: "", extraTasks: "",
  targetModel: "", optimizerModel: "composer-2.5", verifyMode: "command", verifyCommand: "",
  steps: 1, trainBatch: 1, selectionRepeats: 1, concurrency: 1, learningRate: 3,
  slowUpdate: false, gateOnEmptyRepo: false, attemptTimeoutMin: 12, verifyTimeoutSec: 180,
};
const proposal: Proposal = {
  reasoning: "Use a runnable helper and references.", slow: null, edits: [],
  files: [
    { op: "write", path: "SKILL.md", content: document },
    { op: "write", path: "scripts/parse.sh", content: "#!/bin/sh\nprintf done\n", executable: true },
  ],
};

describe("skill drafting", () => {
  it("creates a complete draft without requiring a project or grading command", async () => {
    const propose = vi.fn(async () => proposal);
    const draft = await prepareSkillDraft(normalizeRequest(request), { root: "/tmp/new-skill", document: "", files: [], name: "parser-helper" }, new AbortController().signal, propose, () => undefined);
    expect(draft.kind).toBe("create");
    expect(draft.skill).toBe(document);
    expect(draft.files.find((file) => file.path === "scripts/parse.sh")?.executable).toBe(true);
    expect(propose.mock.calls).toHaveLength(1);
  });

  it("rewrites the existing document and deletes obsolete references before its new baseline", async () => {
    const original = { root: "/tmp/existing", name: "old", document: "---\nname: old\ndescription: An old procedure.\n---\nOld.\n", files: [{ path: "obsolete.md", text: "outdated" }] };
    const config = normalizeRequest({ ...request, workflow: "pretrain", budget: { ...DEFAULT_BUDGET, unlimited: true } });
    const draft = await prepareSkillDraft(config, original, new AbortController().signal, async () => ({ ...proposal, files: [...proposal.files!, { op: "delete", path: "obsolete.md", content: "" }] }), () => undefined);
    expect(draft.files.some((file) => file.path === "obsolete.md")).toBe(false);
    const attempts: string[] = [];
    const summary = await trainSkill({ ...config, skill: draft.skill, files: draft.files, signal: new AbortController().signal, sessionDir: "memory" }, {
      emit: () => undefined, propose: async () => ({ edits: [], slow: null, reasoning: "No improvement." }),
      runAttempt: async (input) => {
        attempts.push(input.skill);
        expect(input.files.some((file) => file.path === "obsolete.md")).toBe(false);
        return { runId: "run", phase: input.phase, ground: input.ground, taskPrompt: "task", summary: "", diffStat: "", keptWorkspace: null,
          score: { hard: 1, soft: 0.5, gate: 0.925, verifyExitCode: 0, verifyOutput: "", toolCalls: 8, durationMs: 1, status: "finished" } };
      },
    });
    expect(attempts.every((skill) => skill === document)).toBe(true);
    expect(summary.bestSkill).toBe(document);
    expect(summary.baseline.passes).toBe(1);
  });

  it("rejects malformed drafts and proposals whose edits were all over budget", async () => {
    const original = { root: "memory", document, files: [{ path: "SKILL.md", text: document }], name: "parser-helper" };
    const config = normalizeRequest({ ...request, workflow: "pretrain" });
    await expect(prepareSkillDraft(config, original, new AbortController().signal, async () => ({ ...proposal, files: [{ op: "write", path: "SKILL.md", content: "# No frontmatter" }] }), () => undefined)).rejects.toThrow(/Frontmatter/);
    await expect(prepareSkillDraft({ ...config, budget: { ...DEFAULT_BUDGET, maxFileChars: 1 } }, original, new AbortController().signal, async () => proposal, () => undefined)).rejects.toThrow(/keinen geänderten/);
  });

  it("does not retain a draft produced after cancellation", async () => {
    const controller = new AbortController();
    await expect(prepareSkillDraft(normalizeRequest(request), { root: "memory", document: "", files: [], name: "new" }, controller.signal, async () => { controller.abort(); return proposal; }, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
  });
});
