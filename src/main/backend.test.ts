import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizedError } from "../shared/localized-error";
import type { SessionEvent, TrainRequest } from "../shared/types";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  userData: "",
  propose: vi.fn(),
  derive: vi.fn(),
  codexPropose: vi.fn(),
  codexDerive: vi.fn(),
  codexExecute: vi.fn(),
  codexAuth: vi.fn(),
  codexLogin: vi.fn(),
  codexModels: vi.fn(),
  verify: vi.fn(),
  attempt: vi.fn(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  languages: ["de-CH"],
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData, getPreferredSystemLanguages: () => mocks.languages },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, fn) },
  dialog: { showOpenDialog: mocks.openDialog, showSaveDialog: mocks.saveDialog }, shell: {},
}));
vi.mock("../trainer/cursor-runner", () => ({
  proposeWithCursor: mocks.propose,
  deriveSkillFields: mocks.derive,
  executeAgent: vi.fn(),
  isStartupError: () => false,
}));
vi.mock("../trainer/codex-runner", () => ({
  proposeWithCodex: mocks.codexPropose,
  deriveFieldsWithCodex: mocks.codexDerive,
  executeWithCodex: mocks.codexExecute,
}));
vi.mock("./codex-provider", () => ({
  readCodexAuth: mocks.codexAuth,
  loginCodex: mocks.codexLogin,
  listCodexModels: mocks.codexModels,
}));
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
  mocks.derive.mockReset();
  mocks.codexPropose.mockReset();
  mocks.codexDerive.mockReset();
  mocks.codexExecute.mockReset();
  mocks.codexAuth.mockReset();
  mocks.codexLogin.mockReset();
  mocks.codexModels.mockReset();
  mocks.verify.mockReset();
  mocks.attempt.mockReset();
  mocks.openDialog.mockReset();
  mocks.saveDialog.mockReset();
  mocks.languages = ["de-CH"];
  events.length = 0;
  await fs.mkdir(path.join(root, "project"), { recursive: true });
  registerBackend();
  await mocks.handlers.get("locale:load")!();
  attachWindow({ on: () => undefined, isDestroyed: () => false, webContents: { send: (_name: string, event: SessionEvent) => events.push(event) } } as never);
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function request(overrides: Partial<TrainRequest> = {}): TrainRequest {
  return { workflow: "create", trainAfterDraft: false, skillName: "parser-helper", skillBrief: "Prepare parser procedures.",
    skillPath: path.join(root, "new-skill"), workspacePath: path.join(root, "project"), auftrag: "", extraTasks: "", verifyMode: "command", verifyCommand: "",
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
    mocks.propose.mockResolvedValue(proposal());
    mocks.verify.mockResolvedValue({ exitCode: 0, output: "already green" });
    await start(request({ trainAfterDraft: true, gateOnEmptyRepo: true, workspacePath, auftrag: "Implement the parser.", verifyCommand: "npm test" }));
    expect(lastSummary()).toMatchObject({ fineTuned: false, draft: { kind: "create" } });
    expect(lastSummary().error).toContain("leeren Repository schon erfolgreich");
    expect(mocks.attempt).not.toHaveBeenCalled();
  });

  it("uses the draft as the fine-tuning baseline and saves the gated winner", async () => {
    const workspacePath = path.join(root, "project");
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

  it("asks the selected model to fill goal and assignment from the skill", async () => {
    const skill = path.join(root, "skills", "parser");
    await fs.mkdir(skill, { recursive: true });
    await fs.writeFile(path.join(skill, "SKILL.md"), "---\nname: parser\ndescription: Parse logs.\n---\n\n# Parser\nRead the log format first.\n");
    mocks.derive.mockResolvedValue({ ziel: "Logs zuverlässig lesen.", auftrag: "Parse logs/app.log zu einer Tabelle." });
    const result = await mocks.handlers.get("skill:derive")!(null, skill, "composer-2.5");
    expect(result).toEqual({ ziel: "Logs zuverlässig lesen.", auftrag: "Parse logs/app.log zu einer Tabelle." });
    expect(mocks.derive).toHaveBeenCalledWith(expect.objectContaining({
      model: "composer-2.5",
      skill: expect.stringContaining("Read the log format first."),
    }));
    await expect(mocks.handlers.get("skill:derive")!(null, skill, "  ")).rejects.toThrow(/Modell/);
    await expect(mocks.handlers.get("skill:derive")!(null, path.join(root, "missing"), "composer-2.5")).rejects.toThrow(/existiert nicht/);
  });
});


describe("language preferences IPC", () => {
  it("detects a supported system language and uses English as fallback", async () => {
    mocks.languages = ["pt-BR", "fr-CH"];
    registerBackend();
    expect(await mocks.handlers.get("locale:load")!()).toBe("fr");
    mocks.languages = ["pt-BR"];
    registerBackend();
    expect(await mocks.handlers.get("locale:load")!()).toBe("en");
  });

  it("persists the selected language independently and broadcasts it to the window", async () => {
    const send = vi.fn();
    attachWindow({ on: () => undefined, isDestroyed: () => false, webContents: { send } } as never);
    await mocks.handlers.get("locale:save")!(null, "it");
    expect(send).toHaveBeenCalledWith("locale:changed", "it");
    expect(JSON.parse(await fs.readFile(path.join(mocks.userData, "preferences.json"), "utf8"))).toEqual({ locale: "it" });
    await expect(fs.stat(path.join(mocks.userData, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
    registerBackend();
    expect(await mocks.handlers.get("locale:load")!()).toBe("it");
  });

  it("rejects unsupported languages without changing the preference", async () => {
    await expect(mocks.handlers.get("locale:save")!(null, "xx")).rejects.toThrow("Nicht unterstützte Sprache");
    expect(await mocks.handlers.get("locale:load")!()).toBe("de");
  });

  it("uses system detection when a saved preference is invalid", async () => {
    await fs.mkdir(mocks.userData, { recursive: true });
    await fs.writeFile(path.join(mocks.userData, "preferences.json"), JSON.stringify({ locale: "xx" }));
    mocks.languages = ["nl-BE"];
    registerBackend();
    expect(await mocks.handlers.get("locale:load")!()).toBe("nl");
  });

  it("localizes native file dialogs using the selected language", async () => {
    mocks.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    mocks.saveDialog.mockResolvedValue({ canceled: true });
    await mocks.handlers.get("locale:save")!(null, "es");
    await mocks.handlers.get("dialog:skill")!();
    expect(mocks.openDialog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ title: "Elegir una carpeta de skill o SKILL.md" }));
    await mocks.handlers.get("dialog:folder")!();
    expect(mocks.openDialog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ title: "Elegir una carpeta de proyecto" }));
    await mocks.handlers.get("dialog:skill-destination")!();
    expect(mocks.saveDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Definir la nueva carpeta del skill", buttonLabel: "Elegir destino" }));
  });
});


describe("localized diagnostic IPC", () => {
  it("resolves low-level skill errors in the saved UI language before IPC serialization", async () => {
    await mocks.handlers.get("locale:save")!(null, "fr");
    await expect(mocks.handlers.get("skill:read")!(null, path.join(root, "missing-skill")))
      .rejects.toThrow("Le chemin du skill n’existe pas.");
  });
});


describe("localized skill analysis IPC", () => {
  it("passes the selected language to analysis and preserves the generated field values", async () => {
    const skill = path.join(root, "parser");
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, "SKILL.md"), document);
    await mocks.handlers.get("locale:save")!(null, "nl");
    const fields = { ziel: "Logbestanden lezen.", auftrag: "Zet logs/app.log om naar een tabel." };
    mocks.derive.mockResolvedValue(fields);
    expect(await mocks.handlers.get("skill:derive")!(null, skill, "composer-2.5")).toEqual(fields);
    expect(mocks.derive).toHaveBeenCalledWith(expect.objectContaining({ locale: "nl", translate: expect.any(Function) }));
    await expect(mocks.handlers.get("skill:derive")!(null, skill, ""))
      .rejects.toThrow("Geen model geselecteerd.");
    mocks.derive.mockRejectedValue(new LocalizedError("runner.analysisFailed"));
    await expect(mocks.handlers.get("skill:derive")!(null, skill, "composer-2.5"))
      .rejects.toThrow("Analyse mislukt.");
  });
});

describe("Codex inference provider IPC", () => {
  it("uses Codex account and model endpoints and rejects unknown providers", async () => {
    const auth = { state: "logged-in", email: "trainer@example.com", via: "login" };
    const models = [{ id: "codex-model", label: "Codex model" }];
    mocks.codexAuth.mockResolvedValue(auth);
    mocks.codexLogin.mockResolvedValue(auth);
    mocks.codexModels.mockResolvedValue(models);
    await expect(mocks.handlers.get("auth:status")!(null, "codex")).resolves.toEqual(auth);
    await expect(mocks.handlers.get("auth:login")!(null, "codex")).resolves.toEqual(auth);
    await expect(mocks.handlers.get("models:list")!(null, "codex")).resolves.toEqual({ models });
    expect(mocks.codexLogin).toHaveBeenCalledWith(expect.any(Function));
    for (const channel of ["auth:status", "auth:login", "models:list"]) {
      await expect(mocks.handlers.get(channel)!(null, "unknown")).rejects.toThrow("Unbekannter Inference-Anbieter");
    }
  });

  it("reports a missing Codex executable without offering Cursor models", async () => {
    const missing = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    mocks.codexAuth.mockRejectedValue(missing);
    mocks.codexModels.mockRejectedValue(missing);
    await expect(mocks.handlers.get("auth:status")!(null, "codex")).resolves.toMatchObject({ state: "error", message: expect.stringContaining("Codex CLI wurde nicht gefunden") });
    await expect(mocks.handlers.get("models:list")!(null, "codex")).resolves.toEqual({ models: [], error: expect.stringContaining("Codex CLI wurde nicht gefunden") });
  });

  it("uses Codex for skill analysis and draft generation and persists the provider", async () => {
    const skillPath = path.join(root, "existing");
    await fs.mkdir(skillPath);
    await fs.writeFile(path.join(skillPath, "SKILL.md"), document);
    const fields = { ziel: "Parse logs.", auftrag: "Create a parser." };
    mocks.codexDerive.mockResolvedValue(fields);
    await expect(mocks.handlers.get("skill:derive")!(null, skillPath, "codex-model", "codex")).resolves.toEqual(fields);
    expect(mocks.codexDerive).toHaveBeenCalledWith(expect.objectContaining({ model: "codex-model", skill: document }));
    expect(mocks.derive).not.toHaveBeenCalled();
    mocks.codexPropose.mockResolvedValue(proposal());
    const result = await start(request({ provider: "codex", targetModel: "codex-model", optimizerModel: "codex-optimizer" }));
    expect(mocks.codexPropose).toHaveBeenCalledWith(expect.objectContaining({ model: "codex-optimizer", kind: "create" }));
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(lastSummary().bestSkill).toBe(document);
    expect(JSON.parse(await fs.readFile(path.join(result.sessionDir, "request.json"), "utf8")).provider).toBe("codex");
    expect(JSON.parse(await fs.readFile(path.join(mocks.userData, "settings.json"), "utf8")).provider).toBe("codex");
  });

  it("routes test authoring, baseline, training and optimizer calls to Codex", async () => {
    mocks.codexPropose.mockResolvedValueOnce(proposal()).mockResolvedValue({ reasoning: "Keep it.", edits: [], files: [], slow: null });
    mocks.codexExecute.mockImplementation(async (input) => {
      const checks = path.join(input.cwd, ".skill-trainer/checks");
      await fs.mkdir(checks, { recursive: true });
      await fs.writeFile(path.join(checks, "run.sh"), "#!/bin/sh\nexit 1\n");
      return { status: "finished", finalText: "Authored", toolCalls: 1, transcript: "", durationMs: 1 };
    });
    mocks.verify.mockResolvedValue({ exitCode: 1, output: "not implemented" });
    mocks.attempt.mockImplementation(async (input) => ({ runId: input.runId, phase: input.phase, ground: input.ground,
      taskPrompt: input.taskPrompt, summary: "done", diffStat: "", keptWorkspace: null,
      score: { hard: 1, soft: 1, gate: 1, verifyExitCode: 0, verifyOutput: "ok", toolCalls: 1, durationMs: 1, status: "finished" } }));
    await start(request({ provider: "codex", trainAfterDraft: true, verifyMode: "agent", auftrag: "Implement the parser.", targetModel: "codex-model", optimizerModel: "codex-optimizer" }));
    expect(lastSummary().error).toBeUndefined();
    expect(mocks.codexExecute).toHaveBeenCalledWith(expect.objectContaining({ model: "codex-model", settingSources: [] }));
    expect(mocks.attempt).toHaveBeenCalled();
    for (const [input] of mocks.attempt.mock.calls) {
      expect(input.execute).toBe(mocks.codexExecute);
      expect(input.model).toBe("codex-model");
    }
    expect(mocks.codexPropose).toHaveBeenCalledWith(expect.objectContaining({ kind: "step", model: "codex-optimizer" }));
    expect(mocks.propose).not.toHaveBeenCalled();
  });
});
