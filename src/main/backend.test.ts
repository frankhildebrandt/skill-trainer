import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, TrainRequest } from "../shared/types";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  userData: "",
  propose: vi.fn(),
  verify: vi.fn(),
  attempt: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, fn) },
  dialog: {}, shell: {},
}));
vi.mock("../trainer/cursor-runner", () => ({ proposeWithCursor: mocks.propose, executeAgent: vi.fn(), isStartupError: () => false }));
vi.mock("../trainer/attempt", () => ({ performAttempt: mocks.attempt }));
vi.mock("../trainer/verify", () => ({ runVerify: mocks.verify }));
vi.mock("../trainer/isolate", () => ({
  assertSafeWorkspace: vi.fn(),
  isolateWorkspace: async (_source: string, dir: string) => ({ dir, cleanup: async () => undefined }),
  createEmptyRepo: async (dir: string) => ({ dir, cleanup: async () => undefined }),
}));
import { attachWindow, registerBackend } from "./backend";

let root: string;
const events: SessionEvent[] = [];
const document = "---\nname: parser-helper\ndescription: Handle parser work.\n---\n\n# Parser\nUse references and scripts.\n";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-session-"));
  mocks.userData = path.join(root, "sessions-data");
  mocks.propose.mockReset();
  mocks.verify.mockReset();
  mocks.attempt.mockReset();
  events.length = 0;
  registerBackend();
  attachWindow({ on: () => undefined, isDestroyed: () => false, webContents: { send: (_name: string, event: SessionEvent) => events.push(event) } } as never);
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function request(overrides: Partial<TrainRequest> = {}): TrainRequest {
  return { workflow: "create", trainAfterDraft: false, skillName: "parser-helper", skillBrief: "Prepare parser procedures.",
    skillPath: path.join(root, "new-skill"), workspacePath: "", auftrag: "", extraTasks: "", verifyMode: "command", verifyCommand: "",
    targetModel: "composer-2.5", optimizerModel: "composer-2.5", steps: 1, trainBatch: 1, selectionRepeats: 1, concurrency: 1,
    learningRate: 3, slowUpdate: false, gateOnEmptyRepo: false, attemptTimeoutMin: 12, verifyTimeoutSec: 180, ...overrides };
}
function start(input: TrainRequest, sessionId = "tab") {
  return mocks.handlers.get("trainer:start")!(null, input, sessionId) as Promise<{ sessionDir: string; sessionId: string }>;
}
function writeBack(sessionId = "tab") {
  return mocks.handlers.get("trainer:writeBack")!(null, sessionId);
}
function lastSummary() {
  const done = events.slice().reverse().find((event) => event.type === "done");
  if (!done || done.type !== "done") throw new Error("No summary");
  return done.summary;
}
function proposal() {
  return { reasoning: "Supply the complete helper.", edits: [], slow: null, files: [
    { op: "write", path: "SKILL.md", content: document },
    { op: "write", path: "scripts/run.sh", content: "#!/bin/sh\nprintf done\n", executable: true },
  ] };
}

describe("skill workflow IPC", () => {
  it("creates a draft in the session and writes the new folder only on apply", async () => {
    const input = request();
    mocks.propose.mockResolvedValue(proposal());
    const result = await start(input);
    await expect(fs.stat(input.skillPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(lastSummary()).toMatchObject({ workflow: "create", fineTuned: false, originalSkill: "", bestSkill: document });
    expect(mocks.attempt).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(result.sessionDir, "best-skill/SKILL.md"), "utf8")).toBe(document);
    const saved = await writeBack();
    expect(saved.backupPath).toBeNull();
    expect(await fs.readFile(path.join(input.skillPath, "SKILL.md"), "utf8")).toBe(document);
    await expect(writeBack()).rejects.toThrow(/existiert schon/);
  });

  it("keeps an existing skill untouched until apply, then backs up and deletes old references", async () => {
    const skillPath = path.join(root, "existing");
    await fs.mkdir(skillPath);
    await fs.writeFile(path.join(skillPath, "SKILL.md"), "---\nname: old\ndescription: Old procedure.\n---\nOld procedure.\n");
    await fs.writeFile(path.join(skillPath, "old.md"), "obsolete");
    mocks.propose.mockResolvedValue({ ...proposal(), files: [...proposal().files, { op: "delete", path: "old.md", content: "" }] });
    await start(request({ workflow: "pretrain", skillPath }));
    expect(await fs.readFile(path.join(skillPath, "old.md"), "utf8")).toBe("obsolete");
    const saved = await writeBack();
    expect(await fs.readFile(path.join(saved.backupPath, "old.md"), "utf8")).toBe("obsolete");
    await expect(fs.stat(path.join(skillPath, "old.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still fine-tunes when the project copy already passes the check", async () => {
    const workspacePath = path.join(root, "project");
    await fs.mkdir(workspacePath);
    mocks.propose.mockResolvedValue(proposal());
    mocks.verify.mockResolvedValue({ exitCode: 0, output: "already green" });
    mocks.attempt.mockImplementation(async (input) => ({ runId: input.runId, phase: input.phase, ground: input.ground,
      taskPrompt: input.taskPrompt, summary: "done", diffStat: "", keptWorkspace: null,
      score: { hard: 1, soft: 0.5, gate: 0.925, verifyExitCode: 0, verifyOutput: "ok", toolCalls: 1, durationMs: 1, status: "finished" } }));
    await start(request({ trainAfterDraft: true, workspacePath, auftrag: "Implement the parser.", verifyCommand: "npm test" }));
    expect(events.some((event) => event.type === "log" && event.message.includes("Fine-Tuning startet trotzdem"))).toBe(true);
    expect(mocks.attempt).toHaveBeenCalled();
    expect(lastSummary()).toMatchObject({ fineTuned: true, draft: { kind: "create" } });
    expect(lastSummary().error).toBeUndefined();
  });

  it("stops before fine-tuning when an empty repository already passes the check", async () => {
    const workspacePath = path.join(root, "project");
    await fs.mkdir(workspacePath);
    mocks.propose.mockResolvedValue(proposal());
    mocks.verify.mockResolvedValue({ exitCode: 0, output: "already green" });
    await start(request({ trainAfterDraft: true, gateOnEmptyRepo: true, workspacePath, auftrag: "Implement the parser.", verifyCommand: "npm test" }));
    expect(lastSummary()).toMatchObject({ fineTuned: false, draft: { kind: "create" } });
    expect(lastSummary().error).toContain("leeren Repository schon erfolgreich");
    expect(mocks.attempt).not.toHaveBeenCalled();
  });

  it("uses the draft as the fine-tuning baseline and saves the gated winner", async () => {
    const workspacePath = path.join(root, "project");
    await fs.mkdir(workspacePath);
    mocks.propose.mockResolvedValueOnce(proposal()).mockResolvedValueOnce({ reasoning: "Use the documented command.", slow: null,
      edits: [{ op: "append", target: "", content: "Run npm test before editing." }], files: [] });
    mocks.verify.mockResolvedValue({ exitCode: 1, output: "not done yet" });
    mocks.attempt.mockImplementation(async (input) => ({ runId: input.runId, phase: input.phase, ground: input.ground,
      taskPrompt: input.taskPrompt, summary: "done", diffStat: "", keptWorkspace: null,
      score: { hard: 1, soft: input.skill.includes("npm test") ? 1 : 0.5,
        gate: input.skill.includes("npm test") ? 1 : 0.925, verifyExitCode: 0, verifyOutput: "ok", toolCalls: 1, durationMs: 1, status: "finished" } }));
    const input = request({ trainAfterDraft: true, workspacePath, auftrag: "Implement the parser.", verifyCommand: "npm test" });
    await start(input);
    expect(mocks.attempt.mock.calls[0][0].skill).toBe(document);
    expect(lastSummary()).toMatchObject({ fineTuned: true, originalSkill: "", draft: { skill: document }, best: { gate: 1 }, baseline: { gate: 0.925 } });
    expect(lastSummary().bestSkill).toContain("Run npm test before editing.");
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    await writeBack();
    expect(await fs.readFile(path.join(input.skillPath, "SKILL.md"), "utf8")).toContain("Run npm test before editing.");
  });

  it("runs two trainings at once and keeps their results apart", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.propose.mockImplementation(async () => {
      await gate;
      return proposal();
    });
    const otherPath = path.join(root, "other-skill");
    const first = start(request(), "one");
    const second = start(request({ skillName: "other-skill", skillPath: otherPath }), "two");
    await expect(start(request(), "one")).rejects.toThrow(/läuft schon/);
    await vi.waitFor(() => {
      expect(events.some((event) => event.sessionId === "one")).toBe(true);
      expect(events.some((event) => event.sessionId === "two")).toBe(true);
    });
    release?.();
    const [left, right] = await Promise.all([first, second]);
    expect(left.sessionId).toBe("one");
    expect(right.sessionId).toBe("two");
    expect(left.sessionDir).not.toBe(right.sessionDir);
    expect(events.filter((event) => event.type === "done").map((event) => event.sessionId).sort()).toEqual(["one", "two"]);
    await writeBack("one");
    await writeBack("two");
    expect(await fs.readFile(path.join(root, "new-skill", "SKILL.md"), "utf8")).toBe(document);
    expect(await fs.readFile(path.join(otherPath, "SKILL.md"), "utf8")).toBe(document);
  });
});
