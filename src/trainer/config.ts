import { estimateRuns } from "../shared/estimate";
import type { SkillScope, TrainRequest } from "../shared/types";
import { extraLines } from "./tasks";

export interface NormalizedTrain {
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
  const auftrag = request.auftrag.trim();
  const verifyMode = request.verifyMode === "agent" ? "agent" : "command";
  const verifyCommand = (request.verifyCommand ?? "").trim();
  const skillPath = request.skillPath.trim();
  const workspacePath = request.workspacePath.trim();
  const targetModel = request.targetModel.trim();
  const optimizerModel = request.optimizerModel.trim() || targetModel;
  if (!skillPath) throw new Error("Wähle einen Skill-Ordner oder eine SKILL.md.");
  if (!workspacePath) throw new Error("Wähle den Projektordner.");
  if (!auftrag) throw new Error("Der Auftrag fehlt.");
  if (verifyMode === "command" && !verifyCommand) {
    throw new Error("Der Prüfbefehl fehlt. Ohne ihn kann das Gate Erfolg nicht von einer Behauptung unterscheiden.");
  }
  if (!targetModel) throw new Error("Wähle das Zielmodell.");

  const steps = clampInt(request.steps, 1, 6, "Schritte");
  const trainBatch = clampInt(request.trainBatch, 1, 6, "Trainingsläufe");
  const selectionRepeats = clampInt(request.selectionRepeats, 1, 4, "Gate-Läufe");
  const concurrency = clampInt(request.concurrency, 1, 6, "Parallelität");
  const learningRate = clampInt(request.learningRate, 1, 6, "Lernrate");
  const attemptTimeoutMin = clampInt(request.attemptTimeoutMin, 1, 45, "Lauf-Zeitlimit");
  const verifyTimeoutSec = clampInt(request.verifyTimeoutSec, 5, 600, "Prüf-Zeitlimit");
  const extras = extraLines(request.extraTasks ?? "");
  if (extras.length > 8) throw new Error("Höchstens 8 zusätzliche Aufträge.");

  const estimate = estimateRuns({
    steps,
    trainBatch,
    selectionRepeats,
    slowUpdate: Boolean(request.slowUpdate),
  });
  const attempts = estimate.attempts + (verifyMode === "agent" ? 1 : 0);
  if (attempts > 48) {
    throw new Error(`Das wären ${attempts} Agent-Läufe. Senke Schritte, Batch oder Gate-Wiederholungen (Maximum 48).`);
  }

  return {
    skillPath,
    workspacePath,
    auftrag,
    extraTasks: extras,
    verifyMode,
    verifyCommand: verifyMode === "agent" ? "" : verifyCommand,
    targetModel,
    optimizerModel,
    steps,
    trainBatch,
    selectionRepeats,
    concurrency,
    learningRate,
    slowUpdate: Boolean(request.slowUpdate),
    gateOnEmptyRepo: Boolean(request.gateOnEmptyRepo),
    skillScope: request.skillScope === "specific" ? "specific" : "general",
    attemptTimeoutMs: attemptTimeoutMin * 60_000,
    verifyTimeoutMs: verifyTimeoutSec * 1000,
  };
}

function clampInt(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} ist keine Zahl.`);
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) throw new Error(`${label} muss zwischen ${min} und ${max} liegen.`);
  return rounded;
}
