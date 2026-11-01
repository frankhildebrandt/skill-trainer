import { translate, type Translate } from "../shared/i18n";
import { learningRateAt } from "../shared/estimate";
import { aggregate, isImprovement } from "../shared/score";
import type {
  AggregateScore,
  OptimizerBudget,
  Rejection,
  SessionSummary,
  SkillFile,
  StepRecord,
  TrainerEvent,
  Trajectory,
} from "../shared/types";
import { applyProposal } from "./candidate";
import { withDocument } from "./skill-bundle";
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
  kind: "step" | "slow" | "create" | "pretrain";
  budget?: OptimizerBudget;
  skillBrief?: string;
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
  translate?: Translate;
  runAttempt: (input: AttemptCall) => Promise<Trajectory>;
  propose: (input: ProposeCall) => Promise<Proposal>;
  emit: (event: TrainerEvent) => void;
}

export interface TrainLoopConfig {
  budget?: OptimizerBudget;
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
  skillBrief?: string;
  files?: SkillFile[];
  skillRoot?: string;
  signal: AbortSignal;
  sessionDir: string;
}

export async function trainSkill(config: TrainLoopConfig, deps: TrainerDeps): Promise<SessionSummary> {
  const t: Translate = deps.translate ?? ((key, values) => translate("de", key, values));
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
        ? t("trainer.baselineEmpty", { count: tasks.selection.length })
        : t("trainer.baseline", { count: tasks.selection.length }),
    });
    const baselineRuns = await batch(config, deps, tasks.selection, "baseline", current, currentFiles);
    baseline = aggregate(baselineRuns.map((run) => run.score));
    currentScore = baseline;
    bestScore = baseline;
    const baselineStep: StepRecord = {
      index: 0,
      kind: "baseline",
      reasoning: t("trainer.originalSkill"),
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
          ? t("trainer.trainingEmpty", { step: label, count: tasks.train.length })
          : t("trainer.training", { step: label, count: tasks.train.length }),
      });
      const trainRuns = await batch(config, deps, tasks.train, "train", current, currentFiles);
      lastTrain = trainRuns;

      deps.emit({ type: "phase", phase: `optimize:${label}` });
      const proposal = await deps.propose({
        skill: current,
        kind: "step",
        learningRate: rate,
        budget: config.budget,
        train: trainRuns,
        rejected,
        files: currentFiles,
        emptyGate: config.gateOnEmptyRepo,
        skillScope: config.skillScope ?? "general",
        skillBrief: config.skillBrief,
        auftrag: config.auftrag,
        signal: config.signal,
      });
      const report = applyProposal({ skill: current, files: currentFiles, proposal, learningRate: rate, budget: config.budget });
      if (report.applied.length === 0 && report.appliedFiles.length === 0) {
        const skipped: StepRecord = {
          index: step + 1,
          kind: "step",
          reasoning: proposal.reasoning || t("trainer.noApplicableEdit"),
          applied: [],
          appliedFiles: [],
          skipped: report.skipped,
          selectionBefore: currentScore,
          selectionAfter: null,
          accepted: false,
          skill: current,
        };
        steps.push(skipped);
        deps.emit({ type: "step", step: skipped });
        deps.emit({ type: "log", message: t("trainer.skipGate", { step: label }) });
        continue;
      }

      deps.emit({ type: "phase", phase: `gate:${label}` });
      deps.emit({
        type: "log",
        message: config.gateOnEmptyRepo
          ? t("trainer.gateEmpty", { step: label, count: tasks.selection.length })
          : t("trainer.gate", { step: label, count: tasks.selection.length }),
      });
      const before = currentScore;
      const selectionRuns = await batch(config, deps, tasks.selection, "gate", report.skill, report.files);
      const after = aggregate(selectionRuns.map((run) => run.score));
      const accepted = isImprovement(after.gate, before.gate);
      if (accepted) {
        current = report.skill;
        currentFiles = report.files;
        currentScore = after;
        bestSkill = current;
        bestFiles = currentFiles;
        bestScore = after;
        deps.emit({
          type: "log",
          message: t("trainer.accepted", { step: label, before: (before.gate * 100).toFixed(1), after: (after.gate * 100).toFixed(1) }),
        });
      } else {
        rejected.push({
          edits: report.applied,
          fileEdits: report.appliedFiles,
          before,
          after,
          reasoning: proposal.reasoning,
          gateRuns: selectionRuns,
        });
        deps.emit({
          type: "log",
          message: t("trainer.rejected", { step: label, before: (before.gate * 100).toFixed(1), after: (after.gate * 100).toFixed(1) }),
        });
      }
      const record: StepRecord = {
        index: step + 1,
        kind: "step",
        reasoning: proposal.reasoning,
        applied: report.applied,
        appliedFiles: report.appliedFiles,
        skipped: report.skipped,
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
        budget: config.budget,
        train: lastTrain,
        rejected,
        files: currentFiles,
        emptyGate: config.gateOnEmptyRepo,
        skillScope: config.skillScope ?? "general",
        skillBrief: config.skillBrief,
        auftrag: config.auftrag,
        signal: config.signal,
      });
      const report = applyProposal({ skill: current, files: currentFiles, proposal, learningRate: 1, budget: config.budget, slow: true });
      const candidate = report.skill;
      if (candidate === current && report.appliedFiles.length === 0) {
        const skipped: StepRecord = {
          index: config.steps + 1,
          kind: "slow",
          reasoning: proposal.reasoning || t("trainer.emptySlow"),
          applied: [],
          skipped: report.skipped,
          selectionBefore: currentScore,
          selectionAfter: null,
          accepted: false,
          skill: current,
        };
        steps.push(skipped);
        deps.emit({ type: "step", step: skipped });
      } else {
        const before = currentScore;
        const selectionRuns = await batch(config, deps, tasks.selection, "slow", candidate, report.files);
        const after = aggregate(selectionRuns.map((run) => run.score));
        const accepted = isImprovement(after.gate, before.gate);
        const tried = proposal.slow
          ? [...report.applied, { op: "append" as const, target: "", content: proposal.slow, why: "slow region" }]
          : report.applied;
        if (accepted) {
          current = candidate;
          currentFiles = report.files;
          currentScore = after;
          bestSkill = current;
          bestFiles = currentFiles;
          bestScore = after;
        } else {
          rejected.push({
            edits: tried,
            fileEdits: report.appliedFiles,
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
          appliedFiles: report.appliedFiles,
          skipped: report.skipped,
          selectionBefore: before,
          selectionAfter: after,
          accepted,
          skill: current,
        };
        steps.push(record);
        deps.emit({ type: "step", step: record });
        deps.emit({
          type: "log",
          message: accepted ? t("trainer.slowAccepted") : t("trainer.slowRejected"),
        });
      }
    }
  } catch (err) {
    if (isAbortError(err) || config.signal.aborted) {
      cancelled = true;
      deps.emit({ type: "log", message: t("trainer.cancelledBest") });
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
        ground: phase === "train" || !config.gateOnEmptyRepo ? "repo" : "empty",
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
