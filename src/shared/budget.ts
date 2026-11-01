import type { OptimizerBudget } from "./types";

export const DEFAULT_BUDGET: OptimizerBudget = {
  unlimited: false,
  maxEditChars: 1800,
  maxAddedChars: 2500,
  maxFileEdits: 4,
  maxFileChars: 12_000,
};

/** Defaults keep older saved sessions within their original edit limits. */
export function restoreBudget(value: unknown): OptimizerBudget {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (key: keyof OptimizerBudget): number => {
    const raw = record[key];
    return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
      ? raw
      : DEFAULT_BUDGET[key] as number;
  };
  return {
    unlimited: record.unlimited === true,
    maxEditChars: number("maxEditChars"),
    maxAddedChars: number("maxAddedChars"),
    maxFileEdits: number("maxFileEdits"),
    maxFileChars: number("maxFileChars"),
  };
}
