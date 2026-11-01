import type { AggregateScore } from "./types";

/** Pass/fail dominates. Tool-call count only separates successful runs. */
export const HARD_WEIGHT = 0.85;
export const SOFT_WEIGHT = 0.15;

export function efficiencySoft(toolCalls: number, passed: boolean): number {
  if (!passed) return 0;
  const calls = Number.isFinite(toolCalls) && toolCalls > 0 ? toolCalls : 0;
  return 1 / (1 + calls / 8);
}

export function gateScore(hard: number, soft: number): number {
  return HARD_WEIGHT * hard + SOFT_WEIGHT * soft;
}

export function aggregate(runs: Array<{ hard: number; soft: number; gate: number }>): AggregateScore {
  if (runs.length === 0) {
    return { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 };
  }
  const n = runs.length;
  let hard = 0;
  let soft = 0;
  let gate = 0;
  let passes = 0;
  for (const run of runs) {
    hard += run.hard;
    soft += run.soft;
    gate += run.gate;
    if (run.hard >= 1) passes += 1;
  }
  return { gate: gate / n, hard: hard / n, soft: soft / n, runs: n, passes };
}

/** Ties stay put. A candidate has to strictly raise the held-out gate score. */
export function isImprovement(next: number, current: number): boolean {
  return next > current + 1e-9;
}
