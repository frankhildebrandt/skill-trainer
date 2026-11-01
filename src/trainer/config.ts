import { DEFAULT_BUDGET } from "../shared/budget";
import { estimateRuns } from "../shared/estimate";
import type { OptimizerBudget, SkillScope, SkillWorkflow, TrainRequest } from "../shared/types";
import { extraLines } from "./tasks";

export interface NormalizedTrain {
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

export function normalizeRequest(request: TrainRequest): NormalizedTrain {
  const workflow = request.workflow ?? "train";
  if (!["train", "pretrain", "create"].includes(workflow)) throw new Error("Unbekannter Workflow.");
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
    throw new Error(workflow === "create" ? "Wähle den Zielordner für den neuen Skill." : "Wähle einen Skill-Ordner oder eine SKILL.md.");
  }
  if (workflow === "create" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error("Der Skill-Name muss aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen bestehen.");
  }
  if (workflow !== "train" && !skillBrief) throw new Error("Beschreibe den Skill und die gewünschten Änderungen.");
  if (trainAfterDraft) {
    if (!workspacePath) throw new Error("Wähle den Projektordner.");
    if (!auftrag) throw new Error("Der Auftrag fehlt.");
    if (verifyMode === "command" && !verifyCommand) {
      throw new Error("Der Prüfbefehl fehlt. Ohne ihn kann das Gate Erfolg nicht von einer Behauptung unterscheiden.");
    }
    if (!targetModel) throw new Error("Wähle das Zielmodell.");
  }
  if (!optimizerModel) throw new Error("Wähle das Optimierermodell.");

  const steps = positiveInt(request.steps, "Schritte");
  const trainBatch = positiveInt(request.trainBatch, "Trainingsläufe");
  const selectionRepeats = positiveInt(request.selectionRepeats, "Gate-Läufe");
  const concurrency = positiveInt(request.concurrency, "Parallelität");
  const learningRate = positiveInt(request.learningRate, "Lernrate");
  const attemptTimeoutMin = positiveInt(request.attemptTimeoutMin, "Lauf-Zeitlimit");
  const verifyTimeoutSec = positiveInt(request.verifyTimeoutSec, "Prüf-Zeitlimit");
  const budget = normalizeBudget(request.budget);
  const runBudget = request.runBudget === null ? null : positiveInt(request.runBudget ?? 48, "Laufbudget");
  const extras = extraLines(request.extraTasks ?? "");
  const estimate = trainAfterDraft
    ? estimateRuns({ steps, trainBatch, selectionRepeats, slowUpdate: Boolean(request.slowUpdate) })
    : { attempts: 0, optimizer: 0 };
  const calls = estimate.attempts + estimate.optimizer
    + (trainAfterDraft && verifyMode === "agent" ? 1 : 0) + (workflow !== "train" ? 1 : 0);
  if (!Number.isSafeInteger(calls)) throw new Error("Die Anzahl der Agent-Läufe ist zu groß.");
  if (runBudget !== null && calls > runBudget) {
    throw new Error(`Das wären bis zu ${calls} Agent-Läufe. Erhöhe das Laufbudget (${runBudget}), hebe es auf oder senke Schritte, Batch und Gate-Wiederholungen.`);
  }

  return {
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

function positiveInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} muss eine positive ganze Zahl sein.`);
  return value;
}

function normalizeBudget(value: OptimizerBudget | undefined): OptimizerBudget {
  const budget = { ...DEFAULT_BUDGET, ...value };
  return {
    unlimited: budget.unlimited === true,
    maxEditChars: positiveInt(budget.maxEditChars, "Zeichen pro Text-Edit"),
    maxAddedChars: positiveInt(budget.maxAddedChars, "Neue Zeichen pro Schritt"),
    maxFileEdits: positiveInt(budget.maxFileEdits, "Datei-Edits"),
    maxFileChars: positiveInt(budget.maxFileChars, "Zeichen pro Datei-Edit"),
  };
}
