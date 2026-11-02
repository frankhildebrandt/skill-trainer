import { isProviderKind, restoreProvider, type ProviderConfig } from "../shared/provider";
import { translate, type Locale, type Translate } from "../shared/i18n";
import { DEFAULT_BUDGET } from "../shared/budget";
import { estimateRuns } from "../shared/estimate";
import type { OptimizerBudget, SkillScope, SkillWorkflow, TrainRequest } from "../shared/types";
import { extraLines } from "./tasks";

export interface NormalizedTrain {
  provider: ProviderConfig;
  workflow: SkillWorkflow;
  skillName: string;
  skillBrief: string;
  trainAfterDraft: boolean;
  budget: OptimizerBudget;
  runBudget: number | null;
  skillPath: string;
  workspacePath: string;
  auftrag: string;
  extraTasks: string[];
  verifyMode: "command" | "agent";
  verifyCommand: string;
  targetModel: string;
  optimizerModel: string;
  steps: number;
  trainBatch: number;
  selectionRepeats: number;
  concurrency: number;
  learningRate: number;
  slowUpdate: boolean;
  gateOnEmptyRepo: boolean;
  skillScope: SkillScope;
  attemptTimeoutMs: number;
  verifyTimeoutMs: number;
}

export function normalizeRequest(request: TrainRequest, locale: Locale = "de"): NormalizedTrain {
  const t: Translate = (key, values) => translate(locale, key, values);
  const kind = typeof request.provider === "string" ? request.provider : request.provider?.kind;
  if (request.provider !== undefined && !isProviderKind(kind)) throw new Error(t("trainer.unknownProvider"));
  const workflow = request.workflow ?? "train";
  if (!["train", "pretrain", "create"].includes(workflow)) throw new Error(t("trainer.unknownWorkflow"));
  const trainAfterDraft = workflow === "train" || request.trainAfterDraft !== false;
  const skillName = request.skillName?.trim() ?? "";
  const skillBrief = request.skillBrief?.trim() ?? "";
  const auftrag = request.auftrag.trim();
  const verifyMode = request.verifyMode === "agent" ? "agent" : "command";
  const verifyCommand = (request.verifyCommand ?? "").trim();
  const skillPath = request.skillPath.trim();
  const workspacePath = request.workspacePath.trim();
  const targetModel = request.targetModel.trim();
  const optimizerModel = request.optimizerModel.trim() || targetModel;
  if (!skillPath) {
    throw new Error(workflow === "create" ? t("trainer.chooseDestination") : t("trainer.chooseSkill"));
  }
  if (workflow === "create" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error(t("trainer.invalidSkillName"));
  }
  if (workflow !== "train" && !skillBrief) throw new Error(t("trainer.describeSkill"));
  if (!workspacePath) throw new Error(t("trainer.chooseProject"));
  if (trainAfterDraft) {
    if (!auftrag) throw new Error(t("trainer.missingTask"));
    if (verifyMode === "command" && !verifyCommand) {
      throw new Error(t("trainer.missingCheck"));
    }
    if (!targetModel) throw new Error(t("trainer.chooseTarget"));
  }
  if (!optimizerModel) throw new Error(t("trainer.chooseOptimizer"));

  const steps = positiveInt(request.steps, t("trainer.steps"), t);
  const trainBatch = positiveInt(request.trainBatch, t("trainer.trainingRuns"), t);
  const selectionRepeats = positiveInt(request.selectionRepeats, t("trainer.gateRuns"), t);
  const concurrency = positiveInt(request.concurrency, t("trainer.concurrency"), t);
  const learningRate = positiveInt(request.learningRate, t("trainer.learningRate"), t);
  const attemptTimeoutMin = positiveInt(request.attemptTimeoutMin, t("trainer.attemptTimeout"), t);
  const verifyTimeoutSec = positiveInt(request.verifyTimeoutSec, t("trainer.verifyTimeout"), t);
  const budget = normalizeBudget(request.budget, t);
  const runBudget = request.runBudget === null ? null : positiveInt(request.runBudget ?? 48, t("trainer.runBudget"), t);
  const extras = extraLines(request.extraTasks ?? "");
  const estimate = trainAfterDraft
    ? estimateRuns({ steps, trainBatch, selectionRepeats, slowUpdate: Boolean(request.slowUpdate) })
    : { attempts: 0, optimizer: 0 };
  const calls = estimate.attempts + estimate.optimizer
    + (trainAfterDraft && verifyMode === "agent" ? 1 : 0) + (workflow !== "train" ? 1 : 0);
  if (!Number.isSafeInteger(calls)) throw new Error(t("trainer.tooManyRuns"));
  if (runBudget !== null && calls > runBudget) {
    throw new Error(t("trainer.budgetExceeded", { calls, budget: runBudget }));
  }

  return {
    provider: restoreProvider(request.provider),
    workflow, skillName, skillBrief, trainAfterDraft, budget, runBudget,
    skillPath, workspacePath, auftrag, extraTasks: extras, verifyMode,
    verifyCommand: verifyMode === "agent" ? "" : verifyCommand,
    targetModel, optimizerModel, steps, trainBatch, selectionRepeats, concurrency, learningRate,
    slowUpdate: Boolean(request.slowUpdate),
    gateOnEmptyRepo: Boolean(request.gateOnEmptyRepo),
    skillScope: request.skillScope === "specific" ? "specific" : "general",
    attemptTimeoutMs: attemptTimeoutMin * 60_000,
    verifyTimeoutMs: verifyTimeoutSec * 1000,
  };
}

function positiveInt(value: number, label: string, t: Translate): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(t("trainer.positiveInteger", { label }));
  return value;
}

function normalizeBudget(value: OptimizerBudget | undefined, t: Translate): OptimizerBudget {
  const budget = { ...DEFAULT_BUDGET, ...value };
  return {
    unlimited: budget.unlimited === true,
    maxEditChars: positiveInt(budget.maxEditChars, t("trainer.editChars"), t),
    maxAddedChars: positiveInt(budget.maxAddedChars, t("trainer.addedChars"), t),
    maxFileEdits: positiveInt(budget.maxFileEdits, t("trainer.fileEdits"), t),
    maxFileChars: positiveInt(budget.maxFileChars, t("trainer.fileChars"), t),
  };
}
