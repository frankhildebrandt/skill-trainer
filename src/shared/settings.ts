import type { TrainRequest } from "./types";

const DEFAULTS: TrainRequest = {
  skillPath: "",
  workspacePath: "",
  auftrag: "",
  extraTasks: "",
  verifyMode: "command",
  verifyCommand: "",
  targetModel: "composer-2.5",
  optimizerModel: "composer-2.5",
  steps: 2,
  trainBatch: 2,
  selectionRepeats: 2,
  concurrency: 2,
  learningRate: 3,
  slowUpdate: true,
  gateOnEmptyRepo: false,
  skillScope: "general",
  attemptTimeoutMin: 12,
  verifyTimeoutSec: 180,
};

/** Turns a saved form or an older session `request.json` back into the settings panel. */
export function restoreSettings(raw: unknown): TrainRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const extra = record.extraTasks;
  const extraTasks = Array.isArray(extra)
    ? extra.filter((line): line is string => typeof line === "string" && line.trim().length > 0).join("\n")
    : typeof extra === "string"
      ? extra
      : DEFAULTS.extraTasks;

  return {
    skillPath: text(record.skillPath, ""),
    workspacePath: text(record.workspacePath, ""),
    auftrag: text(record.auftrag, ""),
    extraTasks,
    verifyMode: record.verifyMode === "agent" ? "agent" : "command",
    verifyCommand: text(record.verifyCommand, ""),
    targetModel: text(record.targetModel, DEFAULTS.targetModel),
    optimizerModel: text(record.optimizerModel, DEFAULTS.optimizerModel),
    steps: numberOr(record.steps, DEFAULTS.steps),
    trainBatch: numberOr(record.trainBatch, DEFAULTS.trainBatch),
    selectionRepeats: numberOr(record.selectionRepeats, DEFAULTS.selectionRepeats),
    concurrency: numberOr(record.concurrency, DEFAULTS.concurrency),
    learningRate: numberOr(record.learningRate, DEFAULTS.learningRate),
    slowUpdate: typeof record.slowUpdate === "boolean" ? record.slowUpdate : DEFAULTS.slowUpdate,
    gateOnEmptyRepo: record.gateOnEmptyRepo === true,
    skillScope: record.skillScope === "specific" ? "specific" : "general",
    attemptTimeoutMin: minutes(record),
    verifyTimeoutSec: seconds(record),
  };
}

export function settingsHaveWork(settings: TrainRequest): boolean {
  return Boolean(settings.skillPath.trim() || settings.workspacePath.trim() || settings.auftrag.trim());
}

function minutes(record: Record<string, unknown>): number {
  if (typeof record.attemptTimeoutMin === "number" && Number.isFinite(record.attemptTimeoutMin)) {
    return record.attemptTimeoutMin;
  }
  if (typeof record.attemptTimeoutMs === "number" && Number.isFinite(record.attemptTimeoutMs)) {
    return Math.max(1, Math.round(record.attemptTimeoutMs / 60_000));
  }
  return DEFAULTS.attemptTimeoutMin;
}

function seconds(record: Record<string, unknown>): number {
  if (typeof record.verifyTimeoutSec === "number" && Number.isFinite(record.verifyTimeoutSec)) {
    return record.verifyTimeoutSec;
  }
  if (typeof record.verifyTimeoutMs === "number" && Number.isFinite(record.verifyTimeoutMs)) {
    return Math.max(1, Math.round(record.verifyTimeoutMs / 1000));
  }
  return DEFAULTS.verifyTimeoutSec;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
