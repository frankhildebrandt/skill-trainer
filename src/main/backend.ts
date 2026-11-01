import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, type NativeImage } from "electron";
import { Cursor, CursorAgentError } from "@cursor/sdk";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthStatus, ModelOption, SessionSummary, SkillDraft, TrainRequest, TrainerEvent, Trajectory } from "../shared/types";
import { aggregate } from "../shared/score";
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

let windowRef: BrowserWindow | null = null;
let pickerWin: BrowserWindow | null = null;
let pickerWorkspace = "";
let settlePick: ((prompt: string | null) => void) | null = null;
let pendingPick: Promise<string | null> | null = null;
let active: AbortController | null = null;
let lastSummary: SessionSummary | null = null;
let lastSkillRoot: string | null = null;
let writeInProgress = false;

export function attachWindow(win: BrowserWindow): void {
  windowRef = win;
  win.on("closed", () => {
    if (windowRef === win) windowRef = null;
  });
}

export function registerBackend(): void {
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
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: "Skill-Ordner oder SKILL.md wählen",
      properties: ["openFile", "openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("dialog:folder", async () => {
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: "Projektordner wählen",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("skills:list", async (_event, workspacePath: string) => {
    const resolved = path.resolve(String(workspacePath ?? ""));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("Zuerst einen Projektordner wählen.");
    return listProjectSkills(resolved);
  });
  ipcMain.handle("dialog:skill-destination", async () => {
    const result = await dialog.showSaveDialog(dialogParent(), {
      title: "Neuen Skill-Ordner festlegen",
      buttonLabel: "Ziel wählen",
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
  ipcMain.handle("trainer:start", async (_event, request: TrainRequest) => {
    if (active || writeInProgress) throw new Error("Es läuft schon ein Training oder Speichervorgang.");
    const controller = new AbortController();
    active = controller;
    try {
      await writeSavedSettings(request);
      const summary = await runSession(request, controller);
      lastSummary = summary;
      return { sessionDir: summary.sessionDir };
    } finally {
      if (active === controller) active = null;
    }
  });
  ipcMain.handle("trainer:cancel", async () => {
    active?.abort();
  });
  ipcMain.handle("trainer:writeBack", async () => {
    if (active || writeInProgress) throw new Error("Es läuft schon ein Training oder Speichervorgang.");
    writeInProgress = true;
    try {
      return await writeBack();
    } finally {
      writeInProgress = false;
    }
  });
  ipcMain.handle("shell:open", async (_event, target: string) => {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  ipcMain.handle("runs:pick", async (_event, workspacePath: string) => {
    const resolved = path.resolve(String(workspacePath ?? ""));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("Zuerst einen Projektordner wählen.");
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
  ipcMain.handle("runs:catalog", (_event, scope: unknown) => {
    if (!pickerWorkspace) throw new Error("Kein Projektordner.");
    const which = scope === "local" || scope === "cloud" ? scope : "all";
    return listRepoRuns(pickerWorkspace, undefined, which);
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

async function runSession(request: TrainRequest, controller: AbortController): Promise<SessionSummary> {
  const config = normalizeRequest(request);
  if (config.trainAfterDraft) {
    assertSafeWorkspace(config.workspacePath);
    const workspaceStat = await fs.stat(config.workspacePath);
    if (!workspaceStat.isDirectory()) throw new Error("Der Projektpfad ist kein Ordner.");
  }
  const bundle = config.workflow === "create" ? await newSkillBundle(config) : await loadSkillBundle(config.skillPath);
  lastSummary = null;
  lastSkillRoot = bundle.root;
  const sessionDir = path.join(app.getPath("userData"), "sessions", stamp());
  await fs.mkdir(path.join(sessionDir, "runs"), { recursive: true });
  await fs.writeFile(path.join(sessionDir, "original.md"), bundle.document);
  await writeSkillTree(path.join(sessionDir, "original-skill"), bundle.files);
  await fs.writeFile(path.join(sessionDir, "request.json"), JSON.stringify(config, null, 2));

  const emit = (event: TrainerEvent) => {
    void fs.appendFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify(event)}\n`).catch(() => undefined);
    if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send("trainer:event", event);
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
      draft = await prepareSkillDraft(config, bundle, controller.signal, propose, emit);
      summary = { ...summary, draft, bestSkill: draft.skill, bestFiles: draft.files };
      await fs.writeFile(path.join(sessionDir, "draft.md"), draft.skill);
      await writeSkillTree(path.join(sessionDir, "draft-skill"), draft.files);
    }
    if (config.trainAfterDraft) {
      const grading: Grading = { verifyCommand: config.verifyCommand, checks: [] };
      if (config.verifyMode === "agent") {
        emit({ type: "phase", phase: "checks" });
        emit({ type: "log", message: "Der Agent schreibt das Testskript, bevor ein Trainingslauf startet." });
        const authored = await authorChecks(config, sessionDir, controller, emit);
        grading.verifyCommand = authored.command;
        grading.checks = authored.files;
      }
      emit({ type: "phase", phase: "preflight" });
      emit({ type: "log", message: config.gateOnEmptyRepo
        ? "Vorprüfung: auf einem leeren Repository muss der Prüfbefehl noch fehlschlagen. Training läuft im Projekt, das Gate auf einem neuen leeren Repository."
        : "Vorprüfung: der Prüfbefehl muss auf einer frischen Kopie noch fehlschlagen." });
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
      emit({ type: "log", message: "Abgebrochen. Ein vorbereiteter Entwurf bleibt erhalten." });
    } else {
      summary.error = explain(err).message;
      emit({ type: "error", message: summary.error });
    }
  }
  await fs.writeFile(path.join(sessionDir, "best.md"), summary.bestSkill);
  await writeSkillTree(path.join(sessionDir, "best-skill"), summary.bestFiles ?? bundle.files);
  await fs.writeFile(path.join(sessionDir, "summary.json"), JSON.stringify(summarize(summary), null, 2));
  lastSummary = summary;
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
  throw new Error("Der Zielordner existiert schon. Wähle für Create-Skill einen neuen Ordner.");
}

function sessionProposer(
  config: ReturnType<typeof normalizeRequest>,
  sessionDir: string,
  emit: (event: TrainerEvent) => void,
): TrainerDeps["propose"] {
  let counter = 0;
  return async (input) => {
    const runId = `optimizer-${++counter}`;
    const title = input.kind === "create" ? "Skill erstellen" : input.kind === "pretrain" ? "Vortraining" : input.kind === "slow" ? "Optimierer Slow" : `Optimierer ${counter}`;
    emit({ type: "log", message: `${title}: Skill-Ordner mit ${config.budget.unlimited ? "unbegrenztem" : "konfiguriertem"} Edit-Budget überarbeiten.` });
    emit({ type: "run_activity", runId, title });
    const cwd = path.join(sessionDir, "optimizer", runId);
    await fs.mkdir(cwd, { recursive: true });
    try {
      const proposal = await proposeWithCursor({ ...input, model: config.optimizerModel, cwd,
        onActivity: (update) => emit({ type: "run_activity", runId, update }) });
      emit({ type: "run_activity", runId, update: { op: "note", text: "Vorschlag ist da." }, settled: true });
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
    emit({ type: "run_activity", runId: "testskript", title: "Testskript" });
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
      const error = new Error("Abgebrochen");
      error.name = "AbortError";
      throw error;
    }
    const files = await harvestChecks(iso.dir);
    await writeChecks(path.join(sessionDir, "checks"), files);
    emit({
      type: "log",
      message: `Testskript geschrieben (${files.length} ${files.length === 1 ? "Datei" : "Dateien"}). Bewertung: ${CHECK_COMMAND}`,
    });
    return { command: CHECK_COMMAND, files };
  } catch (err) {
    keep = true;
    if (!isAbortError(err)) {
      emit({ type: "log", message: `Die Testskript-Kopie bleibt liegen: ${iso.dir}` });
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
      const error = new Error("Abgebrochen");
      error.name = "AbortError";
      throw error;
    }
    if (result.exitCode === 0) {
      throw new Error(
        config.gateOnEmptyRepo
          ? "Der Prüfbefehl ist auf einem leeren Repository schon erfolgreich. Dann sieht das Gate keinen Unterschied zwischen einem Skill, der das Modul erzeugt, und einem leeren Ordner."
          : "Der Prüfbefehl ist auf einer frischen Kopie schon erfolgreich. Dann unterscheidet das Gate einen besseren Skill nicht vom Nichtstun. Der Befehl soll erst fehlschlagen und nach dem Auftrag gelingen.",
      );
    }
    emit({
      type: "log",
      message: config.gateOnEmptyRepo
        ? `Leeres Repository ist rot (Exit ${result.exitCode ?? "keins"}). Training in einer Kopie des Projekts, Gate auf einem neuen leeren Repository.`
        : `Vorprüfung fehlgeschlagen (Exit ${result.exitCode ?? "keins"}). Das ist die richtige Ausgangslage.`,
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
        text: `Prüfung: Exit ${trajectory.score.verifyExitCode ?? "—"} · ${trajectory.score.toolCalls} Werkzeuge · ${trajectory.score.hard >= 1 ? "grün" : "rot"}`,
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

async function writeBack(): Promise<{ backupPath: string | null; skillPath: string }> {
  if (!lastSummary || !lastSkillRoot) throw new Error("Noch kein abgeschlossener Lauf.");
  const summary = lastSummary;
  const files = summary.bestFiles ?? [];
  if (sameBundle(summary.originalSkill, summary.bestSkill, summary.originalFiles, files)) {
    throw new Error("Es gibt keine übernommenen Änderungen.");
  }
  const output = await saveSkillOutput({ destination: lastSkillRoot, files,
    originalFiles: summary.originalFiles, create: summary.workflow === "create", stamp: stamp() });
  return output;
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
    title: "Cursor-Läufe",
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
  throw new Error("Kein Fenster.");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
