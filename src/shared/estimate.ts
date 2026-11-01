export interface RunEstimate {
  attempts: number;
  optimizer: number;
}

export function estimateRuns(input: {
  steps: number;
  trainBatch: number;
  selectionRepeats: number;
  slowUpdate: boolean;
}): RunEstimate {
  const gates = 1 + input.steps + (input.slowUpdate ? 1 : 0);
  return {
    attempts: gates * input.selectionRepeats + input.steps * input.trainBatch,
    optimizer: input.steps + (input.slowUpdate ? 1 : 0),
  };
}

/** Cosine decay from `max` down to 1 across the step index. */
export function learningRateAt(max: number, step: number, steps: number): number {
  const cap = Math.max(1, Math.round(max));
  if (steps <= 1) return cap;
  const t = step / (steps - 1);
  const cosine = 0.5 * (1 + Math.cos(Math.PI * t));
  return Math.max(1, Math.round(cap * cosine));
}
