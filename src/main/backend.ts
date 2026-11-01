import { dialog, shell, type BrowserWindow } from "electron";
import { ipcMain, app } from "electron";
import { Cursor, CursorAgentError } from "@cursor/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthStatus, ModelOption, SessionSummary, TrainRequest, TrainerEvent, Trajectory } from "../shared/types";
import { performAttempt } from "../trainer/attempt";
import { CHECK_COMMAND, harvestChecks, plantChecks, writeChecks, type CheckFile } from "../trainer/checks";
import { normalizeRequest } from "../trainer/config";
import { executeAgent, isStartupError, proposeWithCursor } from "../trainer/cursor-runner";
import { assertSafeWorkspace, createEmptyRepo, isolateWorkspace } from "../trainer/isolate";
import { trainSkill, type AttemptCall } from "../trainer/loop";
import { isAbortError } from "../trainer/pool";
import { buildCheckAuthorPrompt } from "../trainer/prompts";
import { readSavedSettings, writeSavedSettings } from "./settings-store";
import { loadSkillBundle, sameBundle, writeSkillTree, type SkillBundle } from "../trainer/skill-bundle";
import { runVerify } from "../trainer/verify";

let windowRef: BrowserWindow | null = null;
let active: AbortController | null = null;
let lastSummary: SessionSummary | null = null;
let lastSkillRoot: string | null = null;

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
    if (active) throw new Error("Es läuft schon ein Training.");
    await writeSavedSettings(request);
    const controller = new AbortController();
    active = controller;
    try {
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
  ipcMain.handle("trainer:writeBack", () => writeBack());
  ipcMain.handle("shell:open", async (_event, target: string) => {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
}

async function runSession(request: TrainRequest, controller: AbortController): Promise<SessionSummary> {
  const config = normalizeRequest(request);
  assertSafeWorkspace(config.workspacePath);
  const workspaceStat = await fs.stat(config.workspacePath);
  if (!workspaceStat.isDirectory()) throw new Error("Der Projektpfad ist kein Ordner.");

  const bundle = await loadSkillBundle(config.skillPath);
  const skill = bundle.document;
  lastSummary = null;
  lastSkillRoot = bundle.root;
  const sessionDir = path.join(app.getPath("userData"), "sessions", stamp());
  await fs.mkdir(path.join(sessionDir, "runs"), { recursive: true });
  await fs.writeFile(path.join(sessionDir, "original.md"), skill);
  await writeSkillTree(path.join(sessionDir, "original-skill"), bundle.files);
  await fs.writeFile(
    path.join(sessionDir, "request.json"),
    JSON.stringify({ ...config, attemptTimeoutMs: config.attemptTimeoutMs }, null, 2),
  );

  const emit = (event: TrainerEvent) => {
    if (event.type === "done") lastSummary = event.summary;
    void fs.appendFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify(event)}\n`).catch(() => undefined);
    if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send("trainer:event", event);
  };

  const grading: Grading = { verifyCommand: config.verifyCommand, checks: [] };
  try {
    if (config.verifyMode === "agent") {
      emit({ type: "phase", phase: "checks" });
      emit({
        type: "log",
        message: "Der Agent schreibt das Testskript, bevor ein Trainingslauf startet.",
      });
      const authored = await authorChecks(config, sessionDir, controller, emit);
      grading.verifyCommand = authored.command;
      grading.checks = authored.files;
    }
    emit({ type: "phase", phase: "preflight" });
    emit({
      type: "log",
      message: config.gateOnEmptyRepo
        ? "Vorprüfung: auf einem leeren Repository muss der Prüfbefehl noch fehlschlagen. Training und Gate sehen den Projektcode nicht."
        : "Vorprüfung: der Prüfbefehl muss auf einer frischen Kopie noch fehlschlagen.",
    });
    return await runPrepared(config, bundle, grading, sessionDir, controller, emit);
  } catch (err) {
    if (!isAbortError(err)) throw err;
    const summary: SessionSummary = {
      originalSkill: skill,
      bestSkill: skill,
      baseline: { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 },
      best: { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 },
      steps: [],
      rejected: [],
      cancelled: true,
      sessionDir,
    };
    emit({ type: "log", message: "Abgebrochen." });
    emit({ type: "done", summary });
    return summary;
  }
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
        ? `Leeres Repository ist rot (Exit ${result.exitCode ?? "keins"}). Training im Projekt, Gate auf einem neuen leeren Repository.`
        : `Vorprüfung fehlgeschlagen (Exit ${result.exitCode ?? "keins"}). Das ist die richtige Ausgangslage.`,
    });
  } finally {
    await preflight.cleanup();
  }

  let counter = 0;
  let optimizerCount = 0;
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
      slowUpdate: config.slowUpdate,
      gateOnEmptyRepo: config.gateOnEmptyRepo,
      skillScope: config.skillScope,
      files: bundle.files,
      skillRoot: bundle.root,
      signal: controller.signal,
      sessionDir,
    },
    {
      emit,
      propose: async (input) => {
        const runId = `optimizer-${++optimizerCount}`;
        emit({ type: "log", message: "Optimierer liest die Läufe und schlägt begrenzte Edits vor." });
        emit({ type: "run_activity", runId, title: "Optimierer" });
        const dir = path.join(sessionDir, "optimizer");
        await fs.mkdir(dir, { recursive: true });
        try {
          const proposal = await proposeWithCursor({
            ...input,
            model: config.optimizerModel,
            cwd: dir,
            onActivity: (update) => emit({ type: "run_activity", runId, update }),
          });
          emit({ type: "run_activity", runId, update: { op: "note", text: "Vorschlag ist da." }, settled: true });
          return proposal;
        } catch (err) {
          emit({ type: "run_activity", runId, update: { op: "note", text: explain(err).message }, settled: true });
          throw err;
        }
      },
      runAttempt: (input) => runOne(input, config, grading, sessionDir, () => `${input.phase}-${++counter}`, emit),
    },
  );

  await fs.writeFile(path.join(sessionDir, "best.md"), summary.bestSkill);
  await writeSkillTree(path.join(sessionDir, "best-skill"), summary.bestFiles ?? bundle.files);
  await fs.writeFile(path.join(sessionDir, "summary.json"), JSON.stringify(summarize(summary), null, 2));
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

async function writeBack(): Promise<{ backupPath: string; skillPath: string }> {
  if (!lastSummary || !lastSkillRoot) throw new Error("Noch kein abgeschlossener Lauf.");
  const files = lastSummary.bestFiles ?? [];
  if (sameBundle(lastSummary.originalSkill, lastSummary.bestSkill, lastSummary.originalFiles, files)) {
    throw new Error("Kein übernommener Skill. Das Gate hat keine Verbesserung durchgelassen.");
  }
  const backupPath = `${lastSkillRoot}.bak-${stamp()}`;
  await fs.cp(lastSkillRoot, backupPath, { recursive: true });
  await writeSkillTree(lastSkillRoot, files);
  return { backupPath, skillPath: lastSkillRoot };
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

function dialogParent(): BrowserWindow {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  throw new Error("Kein Fenster.");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
