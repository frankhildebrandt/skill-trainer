import { learningRateAt } from "../shared/estimate";
import { aggregate, isImprovement } from "../shared/score";
import type {
  AggregateScore,
  Rejection,
  SessionSummary,
  SkillFile,
  StepRecord,
  TrainerEvent,
  Trajectory,
} from "../shared/types";
import { applyEdits, setSlowRegion } from "./edits";
import { applyFileEdits, withDocument } from "./skill-bundle";
import type { Proposal } from "./json";
import { isAbortError, mapPool, throwIfAborted } from "./pool";
import { buildTasks, type TaskSpec } from "./tasks";

export interface AttemptCall {
  phase: Trajectory["phase"];
  ground: Trajectory["ground"];
  skill: string;
  files: SkillFile[];
  skillRoot: string;
  taskPrompt: string;
  model: string;
  signal: AbortSignal;
}

export interface ProposeCall {
  skill: string;
  kind: "step" | "slow";
  learningRate: number;
  train: Trajectory[];
  rejected: Rejection[];
  files: SkillFile[];
  emptyGate: boolean;
  skillScope: "general" | "specific";
  auftrag: string;
  signal: AbortSignal;
}

export interface TrainerDeps {
  runAttempt: (input: AttemptCall) => Promise<Trajectory>;
  propose: (input: ProposeCall) => Promise<Proposal>;
  emit: (event: TrainerEvent) => void;
}

export interface TrainLoopConfig {
  skill: string;
  auftrag: string;
  extraTasks: string[];
  targetModel: string;
  steps: number;
  trainBatch: number;
  selectionRepeats: number;
  concurrency: number;
  learningRate: number;
  slowUpdate: boolean;
  gateOnEmptyRepo: boolean;
  skillScope?: "general" | "specific";
  files?: SkillFile[];
  skillRoot?: string;
  signal: AbortSignal;
  sessionDir: string;
}

export async function trainSkill(config: TrainLoopConfig, deps: TrainerDeps): Promise<SessionSummary> {
  const original = config.skill;
  let current = original;
  let currentFiles = withDocument(config.files ?? [], original);
  let bestFiles = currentFiles;
  let cancelled = false;
  let error: string | undefined;
  const rejected: Rejection[] = [];
  const steps: StepRecord[] = [];
  const tasks = buildTasks(config.auftrag, config.extraTasks, config.trainBatch, config.selectionRepeats);
  let currentScore: AggregateScore = aggregate([]);
  let bestSkill = current;
  let bestScore = currentScore;
  let baseline = currentScore;
  let lastTrain: Trajectory[] = [];

  const finish = (): SessionSummary => {
    const summary: SessionSummary = {
      originalSkill: original,
      bestSkill,
      originalFiles: withDocument(config.files ?? [], original),
      bestFiles,
      baseline,
      best: bestScore,
      steps,
      rejected,
      cancelled,
      error,
      sessionDir: config.sessionDir,
    };
    deps.emit({ type: "done", summary });
    return summary;
  };

  try {
    deps.emit({ type: "phase", phase: "baseline" });
    deps.emit({
      type: "log",
      message: config.gateOnEmptyRepo
        ? `Baseline: ${tasks.selection.length} Läufe in einem leeren Repository.`
        : `Baseline: ${tasks.selection.length} frische Läufe des Hauptauftrags.`,
    });
    const baselineRuns = await batch(config, deps, tasks.selection, "baseline", current, currentFiles);
    baseline = aggregate(baselineRuns.map((run) => run.score));
    currentScore = baseline;
    bestScore = baseline;
    const baselineStep: StepRecord = {
      index: 0,
      kind: "baseline",
      reasoning: "Ausgangsskill, noch ohne Edit.",
      applied: [],
      skipped: [],
      selectionBefore: baseline,
      selectionAfter: baseline,
      accepted: false,
      skill: current,
    };
    steps.push(baselineStep);
    deps.emit({ type: "step", step: baselineStep });

    for (let step = 0; step < config.steps; step += 1) {
      throwIfAborted(config.signal);
      const rate = learningRateAt(config.learningRate, step, config.steps);
      const label = String(step + 1);
      deps.emit({ type: "phase", phase: `train:${label}` });
      deps.emit({
        type: "log",
        message: config.gateOnEmptyRepo
          ? `Schritt ${label}: ${tasks.train.length} Trainingsläufe im leeren Repository, ohne den Projektcode.`
          : `Schritt ${label}: ${tasks.train.length} Trainingsläufe parallel.`,
      });
      const trainRuns = await batch(config, deps, tasks.train, "train", current, currentFiles);
      lastTrain = trainRuns;

      deps.emit({ type: "phase", phase: `optimize:${label}` });
      const proposal = await deps.propose({
        skill: current,
        kind: "step",
        learningRate: rate,
        train: trainRuns,
        rejected,
        files: currentFiles,
        emptyGate: config.gateOnEmptyRepo,
        skillScope: config.skillScope ?? "general",
        auftrag: config.auftrag,
        signal: config.signal,
      });
      const report = applyEdits(current, proposal.edits, { limit: rate });
      const fileReport = applyFileEdits(
        withDocument(currentFiles, report.skill),
        proposal.files ?? [],
        4,
      );
      if (report.applied.length === 0 && fileReport.applied.length === 0) {
        const skipped: StepRecord = {
          index: step + 1,
          kind: "step",
          reasoning: proposal.reasoning || "Keine anwendbare Änderung.",
          applied: [],
          appliedFiles: [],
          skipped: [...report.skipped, ...fileReport.skipped],
          selectionBefore: currentScore,
          selectionAfter: null,
          accepted: false,
          skill: current,
        };
        steps.push(skipped);
        deps.emit({ type: "step", step: skipped });
        deps.emit({ type: "log", message: `Schritt ${label}: kein Edit angewendet, Gate übersprungen.` });
        continue;
      }

      deps.emit({ type: "phase", phase: `gate:${label}` });
      deps.emit({
        type: "log",
        message: config.gateOnEmptyRepo
          ? `Schritt ${label}: Gate mit ${tasks.selection.length} Läufen im leeren Repository.`
          : `Schritt ${label}: Gate mit ${tasks.selection.length} frischen Läufen.`,
      });
      const before = currentScore;
      const selectionRuns = await batch(config, deps, tasks.selection, "gate", report.skill, fileReport.files);
      const after = aggregate(selectionRuns.map((run) => run.score));
      const accepted = isImprovement(after.gate, before.gate);
      if (accepted) {
        current = report.skill;
        currentFiles = fileReport.files;
        currentScore = after;
        bestSkill = current;
        bestFiles = currentFiles;
        bestScore = after;
        deps.emit({
          type: "log",
          message: `Schritt ${label} übernommen: Gate ${(before.gate * 100).toFixed(1)} → ${(after.gate * 100).toFixed(1)}.`,
        });
      } else {
        rejected.push({
          edits: report.applied,
          fileEdits: fileReport.applied,
          before,
          after,
          reasoning: proposal.reasoning,
          gateRuns: selectionRuns,
        });
        deps.emit({
          type: "log",
          message: `Schritt ${label} verworfen: ${(after.gate * 100).toFixed(1)} liegt nicht über ${(before.gate * 100).toFixed(1)}.`,
        });
      }
      const record: StepRecord = {
        index: step + 1,
        kind: "step",
        reasoning: proposal.reasoning,
        applied: report.applied,
        appliedFiles: fileReport.applied,
        skipped: [...report.skipped, ...fileReport.skipped],
        selectionBefore: before,
        selectionAfter: after,
        accepted,
        skill: current,
      };
      steps.push(record);
      deps.emit({ type: "step", step: record });
    }

    if (config.slowUpdate && lastTrain.length > 0) {
      throwIfAborted(config.signal);
      deps.emit({ type: "phase", phase: "slow" });
      const proposal = await deps.propose({
        skill: current,
        kind: "slow",
        learningRate: 1,
        train: lastTrain,
        rejected,
        files: currentFiles,
        emptyGate: config.gateOnEmptyRepo,
        skillScope: config.skillScope ?? "general",
        auftrag: config.auftrag,
        signal: config.signal,
      });
      let candidate = proposal.slow ? setSlowRegion(current, proposal.slow) : current;
      const report = applyEdits(candidate, proposal.edits, { limit: 1 });
      candidate = report.skill;
      const fileReport = applyFileEdits(
        withDocument(currentFiles, candidate),
        proposal.files ?? [],
        4,
      );
      if (candidate === current && fileReport.applied.length === 0) {
        const skipped: StepRecord = {
          index: config.steps + 1,
          kind: "slow",
          reasoning: proposal.reasoning || "Slow-Update leer.",
          applied: [],
          skipped: [...report.skipped, ...fileReport.skipped],
          selectionBefore: currentScore,
          selectionAfter: null,
          accepted: false,
          skill: current,
        };
        steps.push(skipped);
        deps.emit({ type: "step", step: skipped });
      } else {
        const before = currentScore;
        const selectionRuns = await batch(config, deps, tasks.selection, "slow", candidate, fileReport.files);
        const after = aggregate(selectionRuns.map((run) => run.score));
        const accepted = isImprovement(after.gate, before.gate);
        const tried = proposal.slow
          ? [...report.applied, { op: "append" as const, target: "", content: proposal.slow, why: "slow region" }]
          : report.applied;
        if (accepted) {
          current = candidate;
          currentFiles = fileReport.files;
          currentScore = after;
          bestSkill = current;
          bestFiles = currentFiles;
          bestScore = after;
        } else {
          rejected.push({
            edits: tried,
            fileEdits: fileReport.applied,
            before,
            after,
            reasoning: proposal.reasoning,
            gateRuns: selectionRuns,
          });
        }
        const record: StepRecord = {
          index: config.steps + 1,
          kind: "slow",
          reasoning: proposal.reasoning,
          applied: tried,
          appliedFiles: fileReport.applied,
          skipped: [...report.skipped, ...fileReport.skipped],
          selectionBefore: before,
          selectionAfter: after,
          accepted,
          skill: current,
        };
        steps.push(record);
        deps.emit({ type: "step", step: record });
        deps.emit({
          type: "log",
          message: accepted ? "Slow-Update übernommen." : "Slow-Update verworfen.",
        });
      }
    }
  } catch (err) {
    if (isAbortError(err) || config.signal.aborted) {
      cancelled = true;
      deps.emit({ type: "log", message: "Abgebrochen. Der bisher beste Skill bleibt erhalten." });
    } else {
      error = err instanceof Error ? err.message : String(err);
      deps.emit({ type: "error", message: error });
    }
  }

  return finish();
}

async function batch(
  config: TrainLoopConfig,
  deps: TrainerDeps,
  tasks: TaskSpec[],
  phase: Trajectory["phase"],
  skill: string,
  files: SkillFile[],
): Promise<Trajectory[]> {
  throwIfAborted(config.signal);
  const controller = new AbortController();
  const onParent = () => controller.abort(config.signal.reason);
  if (config.signal.aborted) controller.abort(config.signal.reason);
  else config.signal.addEventListener("abort", onParent, { once: true });
  try {
    return await mapPool(tasks, config.concurrency, (task) =>
      deps.runAttempt({
        phase,
        ground: config.gateOnEmptyRepo ? "empty" : "repo",
        skill,
        files: withDocument(files, skill),
        skillRoot: config.skillRoot ?? "",
        taskPrompt: task.prompt,
        model: config.targetModel,
        signal: controller.signal,
      }),
    );
  } catch (err) {
    controller.abort();
    throw err;
  } finally {
    config.signal.removeEventListener("abort", onParent);
  }
}
