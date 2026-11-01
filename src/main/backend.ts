import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, type NativeImage } from "electron";
import { Cursor, CursorAgentError } from "@cursor/sdk";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthStatus, ModelOption, SessionEvent, SessionSummary, SkillDraft, TrainRequest, TrainerEvent, Trajectory } from "../shared/types";
import { aggregate } from "../shared/score";
import { isLocale, resolveLocale, translate, type Locale, type TranslationKey } from "../shared/i18n";
import { readSavedLocale, writeSavedLocale } from "./locale-store";
import { performAttempt } from "../trainer/attempt";
import { CHECK_COMMAND, harvestChecks, plantChecks, writeChecks, type CheckFile } from "../trainer/checks";
import { normalizeRequest } from "../trainer/config";
import { executeAgent, isStartupError, proposeWithCursor } from "../trainer/cursor-runner";
import { prepareSkillDraft } from "../trainer/draft";
import { assertSafeWorkspace, createEmptyRepo, isolateWorkspace } from "../trainer/isolate";
import { trainSkill, type AttemptCall, type TrainerDeps } from "../trainer/loop";
import { isAbortError } from "../trainer/pool";
import { buildCheckAuthorPrompt } from "../trainer/prompts";
import { readSavedSettings, writeSavedSettings } from "./settings-store";
import { loadSkillBundle, sameBundle, writeSkillTree, type SkillBundle } from "../trainer/skill-bundle";
import { runVerify } from "../trainer/verify";
import { saveSkillOutput } from "../trainer/skill-output";
import { listProjectSkills } from "../trainer/project-skills";
import { listRepoRuns } from "../trainer/repo-runs";

let currentLocale: Locale = "en";
let windowRef: BrowserWindow | null = null;
let pickerWin: BrowserWindow | null = null;
let pickerWorkspace = "";
let settlePick: ((prompt: string | null) => void) | null = null;
let pendingPick: Promise<string | null> | null = null;

interface SessionRecord {
  running: boolean;
  controller: AbortController;
  summary: SessionSummary | null;
  skillRoot: string | null;
  writing: boolean;
}

const sessions = new Map<string, SessionRecord>();

export function attachWindow(win: BrowserWindow): void {
  windowRef = win;
  win.on("closed", () => {
    if (windowRef === win) windowRef = null;
  });
}

export function registerBackend(): void {
  sessions.clear();
  currentLocale = resolveLocale(app.getPreferredSystemLanguages());
  const localeReady = readSavedLocale().then((locale) => { currentLocale = locale; });
  let localeWrite = Promise.resolve();
  ipcMain.handle("locale:load", async () => {
    await localeReady;
    return currentLocale;
  });
  ipcMain.handle("locale:save", async (_event, locale: unknown) => {
    await localeReady;
    if (!isLocale(locale)) throw new Error(t("backend.invalidLocale"));
    currentLocale = locale;
    if (pickerWin && !pickerWin.isDestroyed()) pickerWin.setTitle(t("backend.cursorRuns"));
    for (const win of new Set([windowRef, pickerWin])) {
      if (win && !win.isDestroyed()) win.webContents.send("locale:changed", locale);
    }
    localeWrite = localeWrite.catch(() => undefined).then(() => writeSavedLocale(locale));
    await localeWrite;
  });
  ipcMain.handle("auth:status", () => readAuth());
  ipcMain.handle("auth:login", async () => {
    await Cursor.auth.login({
      apiKeyName: "skill-trainer",
      openBrowser: (url) => {
        void shell.openExternal(url);
      },
    });
    return readAuth();
  });
  ipcMain.handle("models:list", () => listModels());
  ipcMain.handle("dialog:skill", async () => {
    await localeReady;
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: t("backend.chooseSkill"),
      properties: ["openFile", "openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("dialog:folder", async () => {
    await localeReady;
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: t("backend.chooseProject"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("skills:list", async (_event, workspacePath: string) => {
    const resolved = path.resolve(String(workspacePath ?? ""));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(t("backend.chooseProjectFirst"));
    return listProjectSkills(resolved);
  });
  ipcMain.handle("dialog:skill-destination", async () => {
    await localeReady;
    const result = await dialog.showSaveDialog(dialogParent(), {
      title: t("backend.skillDestination"),
      buttonLabel: t("backend.chooseDestination"),
      defaultPath: "new-skill",
      properties: ["createDirectory"],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });
  ipcMain.handle("settings:load", () => readSavedSettings());
  ipcMain.handle("settings:save", async (_event, request: TrainRequest) => {
    await writeSavedSettings(request);
  });
  ipcMain.handle("skill:read", async (_event, skillPath: string) => {
    const bundle = await loadSkillBundle(skillPath);
    return {
      name: bundle.name,
      chars: bundle.document.length,
      preview: bundle.document.slice(0, 1200),
      root: bundle.root,
      fileCount: bundle.files.length,
      files: bundle.files.map((file) => file.path),
    };
  });
  ipcMain.handle("trainer:start", async (_event, request: TrainRequest, sessionId: unknown) => {
    await localeReady;
    const id = parseSessionId(sessionId);
    const current = sessions.get(id);
    if (current?.running || current?.writing) throw new Error(t("backend.alreadyRunning"));
    const controller = new AbortController();
    const record: SessionRecord = { running: true, controller, summary: null, skillRoot: null, writing: false };
    sessions.set(id, record);
    try {
      await writeSavedSettings(request);
      const summary = await runSession(request, controller, id, record);
      return { sessionDir: summary.sessionDir, sessionId: id };
    } finally {
      record.running = false;
    }
  });
  ipcMain.handle("trainer:cancel", async (_event, sessionId: unknown) => {
    sessions.get(parseSessionId(sessionId))?.controller.abort();
  });
  ipcMain.handle("trainer:writeBack", async (_event, sessionId: unknown) => {
    const record = sessions.get(parseSessionId(sessionId));
    if (!record) throw new Error(t("backend.noFinishedRun"));
    if (record.running || record.writing) throw new Error(t("backend.busy"));
    record.writing = true;
    try {
      return await writeBack(record);
    } finally {
      record.writing = false;
    }
  });
  ipcMain.handle("shell:open", async (_event, target: string) => {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  ipcMain.handle("runs:pick", async (_event, workspacePath: string) => {
    const resolved = path.resolve(String(workspacePath ?? ""));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(t("backend.chooseProjectFirst"));
    if (pickerWin && !pickerWin.isDestroyed() && pendingPick) {
      pickerWin.focus();
      return pendingPick;
    }
    pickerWorkspace = resolved;
    const win = openRunPicker();
    pendingPick = new Promise((resolve) => {
      settlePick = (prompt) => {
        settlePick = null;
        pendingPick = null;
        resolve(prompt);
      };
    });
    win.on("closed", () => {
      if (pickerWin === win) pickerWin = null;
      settlePick?.(null);
    });
    return pendingPick;
  });
  ipcMain.handle("runs:catalog", async (_event, scope: unknown) => {
    await localeReady;
    if (!pickerWorkspace) throw new Error(t("backend.noProject"));
    const which = scope === "local" || scope === "cloud" ? scope : "all";
    return listRepoRuns(pickerWorkspace, undefined, which, currentLocale);
  });
  ipcMain.handle("runs:choose", (event, prompt: unknown) => {
    const text = typeof prompt === "string" ? prompt.trim() : "";
    if (!text) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    settlePick?.(text);
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.handle("runs:cancel", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    settlePick?.(null);
    if (win && !win.isDestroyed()) win.close();
  });
}

async function runSession(
  request: TrainRequest,
  controller: AbortController,
  sessionId: string,
  record: SessionRecord,
): Promise<SessionSummary> {
  const config = normalizeRequest(request, currentLocale);
  if (config.trainAfterDraft) {
    assertSafeWorkspace(config.workspacePath);
    const workspaceStat = await fs.stat(config.workspacePath);
    if (!workspaceStat.isDirectory()) throw new Error(t("backend.projectNotFolder"));
  }
  const bundle = config.workflow === "create" ? await newSkillBundle(config) : await loadSkillBundle(config.skillPath);
  record.summary = null;
  record.skillRoot = bundle.root;
  const sessionDir = path.join(app.getPath("userData"), "sessions", stamp());
  await fs.mkdir(path.join(sessionDir, "runs"), { recursive: true });
  await fs.writeFile(path.join(sessionDir, "original.md"), bundle.document);
  await writeSkillTree(path.join(sessionDir, "original-skill"), bundle.files);
  await fs.writeFile(path.join(sessionDir, "request.json"), JSON.stringify(config, null, 2));

  const emit = (event: TrainerEvent) => {
    const tagged: SessionEvent = { ...event, sessionId };
    void fs.appendFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify(tagged)}\n`).catch(() => undefined);
    if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send("trainer:event", tagged);
  };
  const propose = sessionProposer(config, sessionDir, emit);
  let draft: SkillDraft | undefined;
  let summary: SessionSummary = {
    workflow: config.workflow, fineTuned: false,
    originalSkill: bundle.document, bestSkill: bundle.document,
    originalFiles: bundle.files, bestFiles: bundle.files,
    baseline: aggregate([]), best: aggregate([]), steps: [], rejected: [], cancelled: false, sessionDir,
  };
  try {
    if (config.workflow !== "train") {
      draft = await prepareSkillDraft(config, bundle, controller.signal, propose, emit, currentLocale);
      summary = { ...summary, draft, bestSkill: draft.skill, bestFiles: draft.files };
      await fs.writeFile(path.join(sessionDir, "draft.md"), draft.skill);
      await writeSkillTree(path.join(sessionDir, "draft-skill"), draft.files);
    }
    if (config.trainAfterDraft) {
      const grading: Grading = { verifyCommand: config.verifyCommand, checks: [] };
      if (config.verifyMode === "agent") {
        emit({ type: "phase", phase: "checks" });
        emit({ type: "log", message: t("backend.authoringChecks") });
        const authored = await authorChecks(config, sessionDir, controller, emit);
        grading.verifyCommand = authored.command;
        grading.checks = authored.files;
      }
      emit({ type: "phase", phase: "preflight" });
      emit({ type: "log", message: config.gateOnEmptyRepo
        ? t("backend.preflightEmpty")
        : t("backend.preflight") });
      const prepared = draft ? { ...bundle, document: draft.skill, files: draft.files } : bundle;
      const result = await runPrepared(config, prepared, grading, sessionDir, controller, (event) => {
        if (event.type !== "done") emit(event);
      }, propose);
      summary = { ...result, workflow: config.workflow, draft, fineTuned: result.baseline.runs > 0,
        originalSkill: bundle.document, originalFiles: bundle.files };
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      summary.cancelled = true;
      emit({ type: "log", message: t("backend.cancelledDraft") });
    } else {
      summary.error = explain(err).message;
      emit({ type: "error", message: summary.error });
    }
  }
  await fs.writeFile(path.join(sessionDir, "best.md"), summary.bestSkill);
  await writeSkillTree(path.join(sessionDir, "best-skill"), summary.bestFiles ?? bundle.files);
  await fs.writeFile(path.join(sessionDir, "summary.json"), JSON.stringify(summarize(summary), null, 2));
  record.summary = summary;
  emit({ type: "done", summary });
  return summary;
}

async function newSkillBundle(config: ReturnType<typeof normalizeRequest>): Promise<SkillBundle> {
  const root = path.resolve(config.skillPath);
  try {
    await fs.lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { root, document: "", files: [], name: config.skillName };
    }
    throw error;
  }
  throw new Error(t("backend.destinationExists"));
}

function sessionProposer(
  config: ReturnType<typeof normalizeRequest>,
  sessionDir: string,
  emit: (event: TrainerEvent) => void,
): TrainerDeps["propose"] {
  let counter = 0;
  return async (input) => {
    const runId = `optimizer-${++counter}`;
    const title = input.kind === "create" ? t("backend.createSkill") : input.kind === "pretrain" ? t("backend.pretraining") : input.kind === "slow" ? t("backend.slowOptimizer") : t("backend.optimizer", { count: counter });
    emit({ type: "log", message: t(config.budget.unlimited ? "backend.optimizeUnlimited" : "backend.optimizeConfigured", { title }) });
    emit({ type: "run_activity", runId, title, label: { key: input.kind === "create" ? "backend.createSkill" : input.kind === "pretrain" ? "backend.pretraining" : input.kind === "slow" ? "backend.slowOptimizer" : "backend.optimizer", values: { count: counter } } });
    const cwd = path.join(sessionDir, "optimizer", runId);
    await fs.mkdir(cwd, { recursive: true });
    try {
      const proposal = await proposeWithCursor({ ...input, model: config.optimizerModel, cwd,
        onActivity: (update) => emit({ type: "run_activity", runId, update }) });
      emit({ type: "run_activity", runId, update: { op: "note", text: t("backend.proposalReady") }, settled: true });
      return proposal;
    } catch (err) {
      emit({ type: "run_activity", runId, update: { op: "note", text: explain(err).message }, settled: true });
      throw err;
    }
  };
}

interface Grading {
  verifyCommand: string;
  checks: CheckFile[];
}

async function authorChecks(
  config: ReturnType<typeof normalizeRequest>,
  sessionDir: string,
  controller: AbortController,
  emit: (event: TrainerEvent) => void,
): Promise<{ command: string; files: CheckFile[] }> {
  const dest = path.join(sessionDir, "test-author");
  const iso = await isolateWorkspace(config.workspacePath, dest);
  let keep = false;
  try {
    emit({ type: "run_activity", runId: "testskript", title: t("backend.testScript"), label: { key: "backend.testScript" } });
    const trace = await executeAgent({
      cwd: iso.dir,
      model: config.targetModel,
      prompt: buildCheckAuthorPrompt({ auftrag: config.auftrag, emptyGate: config.gateOnEmptyRepo }),
      signal: controller.signal,
      timeoutMs: config.attemptTimeoutMs,
      settingSources: [],
      onActivity: (update) => emit({ type: "run_activity", runId: "testskript", update }),
    });
    if (controller.signal.aborted || trace.status === "cancelled") {
      const error = new Error(t("backend.cancelled"));
      error.name = "AbortError";
      throw error;
    }
    const files = await harvestChecks(iso.dir);
    await writeChecks(path.join(sessionDir, "checks"), files);
    emit({
      type: "log",
      message: t(files.length === 1 ? "backend.checksWrittenOne" : "backend.checksWritten", { count: files.length, command: CHECK_COMMAND }),
    });
    return { command: CHECK_COMMAND, files };
  } catch (err) {
    keep = true;
    if (!isAbortError(err)) {
      emit({ type: "log", message: t("backend.checksKept", { path: iso.dir }) });
    }
    throw err;
  } finally {
    emit({ type: "run_activity", runId: "testskript", settled: true });
    if (!keep) await iso.cleanup().catch(() => undefined);
  }
}

async function runPrepared(
  config: ReturnType<typeof normalizeRequest>,
  bundle: SkillBundle,
  grading: Grading,
  sessionDir: string,
  controller: AbortController,
  emit: (event: TrainerEvent) => void,
  propose: TrainerDeps["propose"],
): Promise<SessionSummary> {
  const skill = bundle.document;
  const preflightDir = path.join(sessionDir, "preflight");
  const preflight = config.gateOnEmptyRepo
    ? await createEmptyRepo(preflightDir)
    : await isolateWorkspace(config.workspacePath, preflightDir);
  try {
    if (grading.checks.length > 0) await plantChecks(preflight.dir, grading.checks);
    const result = await runVerify(grading.verifyCommand, preflight.dir, config.verifyTimeoutMs, controller.signal);
    if (controller.signal.aborted) {
      const error = new Error(t("backend.cancelled"));
      error.name = "AbortError";
      throw error;
    }
    if (result.exitCode === 0) {
      throw new Error(
        config.gateOnEmptyRepo
          ? t("backend.alreadyPassesEmpty")
          : t("backend.alreadyPasses"),
      );
    }
    emit({
      type: "log",
      message: config.gateOnEmptyRepo
        ? t("backend.emptyReady", { code: result.exitCode ?? t("backend.noExitCode") })
        : t("backend.preflightReady", { code: result.exitCode ?? t("backend.noExitCode") }),
    });
  } finally {
    await preflight.cleanup();
  }

  let counter = 0;
  const summary = await trainSkill(
    {
      skill,
      auftrag: config.auftrag,
      extraTasks: config.extraTasks,
      targetModel: config.targetModel,
      steps: config.steps,
      trainBatch: config.trainBatch,
      selectionRepeats: config.selectionRepeats,
      concurrency: config.concurrency,
      learningRate: config.learningRate,
      budget: config.budget,
      slowUpdate: config.slowUpdate,
      gateOnEmptyRepo: config.gateOnEmptyRepo,
      skillScope: config.skillScope,
      skillBrief: config.skillBrief,
      files: bundle.files,
      skillRoot: bundle.root,
      signal: controller.signal,
      sessionDir,
    },
    {
      emit,
      propose,
      translate: t,
      runAttempt: (input) => runOne(input, config, grading, sessionDir, () => `${input.phase}-${++counter}`, emit),
    },
  );

  return summary;
}

async function runOne(
  input: AttemptCall,
  config: ReturnType<typeof normalizeRequest>,
  grading: Grading,
  sessionDir: string,
  nextId: () => string,
  emit: (event: TrainerEvent) => void,
): Promise<Trajectory> {
  const runId = nextId();
  emit({ type: "run_started", run: { runId, phase: input.phase, ground: input.ground, taskPrompt: input.taskPrompt } });
  try {
    const trajectory = await performAttempt({
      runId,
      phase: input.phase,
      ground: input.ground,
      workspacePath: config.workspacePath,
      runDir: path.join(sessionDir, "runs", runId),
      skill: input.skill,
      files: input.files,
      skillRoot: input.skillRoot,
      skillPath: config.skillPath,
      taskPrompt: input.taskPrompt,
      model: input.model,
      verifyCommand: grading.verifyCommand,
      checks: grading.checks,
      verifyTimeoutMs: config.verifyTimeoutMs,
      attemptTimeoutMs: config.attemptTimeoutMs,
      signal: input.signal,
      onActivity: (update) => emit({ type: "run_activity", runId, update }),
      execute: executeAgent,
    });
    emit({
      type: "run_activity",
      runId,
      update: {
        op: "note",
        text: t("backend.runResult", { code: trajectory.score.verifyExitCode ?? "—", tools: trajectory.score.toolCalls, result: t(trajectory.score.hard >= 1 ? "backend.pass" : "backend.fail") }),
      },
    });
    emit({ type: "run_finished", run: trajectory });
    return trajectory;
  } catch (err) {
    const message = explain(err).message;
    const failed: Trajectory = {
      runId,
      phase: input.phase,
      ground: input.ground,
      taskPrompt: input.taskPrompt,
      score: {
        hard: 0,
        soft: 0,
        gate: 0,
        verifyExitCode: null,
        verifyOutput: message,
        toolCalls: 0,
        durationMs: 0,
        status: "error",
      },
      summary: message,
      diffStat: "",
      keptWorkspace: null,
      error: message,
    };
    emit({ type: "run_activity", runId, update: { op: "note", text: message } });
    emit({ type: "run_finished", run: failed });
    if (isStartupError(err)) throw explain(err);
    throw err;
  }
}

async function writeBack(record: SessionRecord): Promise<{ backupPath: string | null; skillPath: string }> {
  if (!record.summary || !record.skillRoot) throw new Error(t("backend.noFinishedRun"));
  const summary = record.summary;
  const files = summary.bestFiles ?? [];
  if (sameBundle(summary.originalSkill, summary.bestSkill, summary.originalFiles, files)) {
    throw new Error(t("backend.noChanges"));
  }
  const output = await saveSkillOutput({ destination: record.skillRoot, files,
    originalFiles: summary.originalFiles, create: summary.workflow === "create", stamp: stamp() });
  return output;
}

function parseSessionId(value: unknown): string {
  if (typeof value !== "string") throw new Error(t("backend.chooseTraining"));
  const id = value.trim();
  if (!id || id.length > 80 || /[^\w.-]/.test(id)) throw new Error(t("backend.invalidTrainingId"));
  return id;
}

async function readAuth(): Promise<AuthStatus> {
  const viaEnv = Boolean(process.env.CURSOR_API_KEY?.trim());
  try {
    const status = await Cursor.auth.status();
    if (status.status === "logged-in") {
      return { state: "logged-in", email: status.email ?? null, via: viaEnv ? "env" : "login" };
    }
  } catch (err) {
    if (!viaEnv) {
      return { state: "error", email: null, via: "none", message: explain(err).message };
    }
  }
  if (viaEnv) return { state: "logged-in", email: null, via: "env" };
  return { state: "logged-out", email: null, via: "none" };
}

async function listModels(): Promise<{ models: ModelOption[]; error?: string }> {
  try {
    const models = await Cursor.models.list();
    const options = models.map((model) => ({
      id: model.id,
      label: model.displayName || model.id,
    }));
    if (!options.some((model) => model.id === "composer-2.5")) {
      options.unshift({ id: "composer-2.5", label: "Composer 2.5" });
    }
    return { models: options };
  } catch (err) {
    return {
      models: [{ id: "composer-2.5", label: "Composer 2.5" }],
      error: explain(err).message,
    };
  }
}

function summarize(summary: SessionSummary): unknown {
  return {
    sessionDir: summary.sessionDir,
    cancelled: summary.cancelled,
    error: summary.error ?? null,
    baseline: summary.baseline,
    best: summary.best,
    accepted: summary.steps.filter((step) => step.accepted).length,
    rejected: summary.rejected.length,
  };
}

function explain(err: unknown): Error {
  if (err instanceof CursorAgentError) return new Error(err.message);
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function openRunPicker(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 780,
    minWidth: 680,
    minHeight: 520,
    title: t("backend.cursorRuns"),
    backgroundColor: "#030509",
    icon: loadIcon(),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 18, y: 19 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  pickerWin = win;
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("picker", "runs");
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { picker: "runs" } });
  }
  return win;
}

function loadIcon(): NativeImage | undefined {
  const file = path.join(app.getAppPath(), "resources", "icon.png");
  if (!existsSync(file)) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

function dialogParent(): BrowserWindow {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  throw new Error(t("backend.noWindow"));
}

function stamp(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
}

function t(key: TranslationKey, values?: Record<string, string | number>): string {
  return translate(currentLocale, key, values);
}
