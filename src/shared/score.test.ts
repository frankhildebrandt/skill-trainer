import { describe, expect, it } from "vitest";
import { estimateRuns, learningRateAt } from "./estimate";
import { aggregate, efficiencySoft, gateScore, isImprovement } from "./score";

describe("gate score", () => {
  it("ranks a pass above any failure", () => {
    const messyPass = gateScore(1, efficiencySoft(40, true));
    const cleanFail = gateScore(0, efficiencySoft(0, false));
    expect(messyPass).toBeGreaterThan(cleanFail);
    expect(isImprovement(messyPass, cleanFail)).toBe(true);
  });

  it("ranks fewer tool calls higher when both runs pass", () => {
    const lean = gateScore(1, efficiencySoft(2, true));
    const noisy = gateScore(1, efficiencySoft(20, true));
    expect(lean).toBeGreaterThan(noisy);
  });

  it("rejects ties", () => {
    expect(isImprovement(0.9, 0.9)).toBe(false);
  });

  it("averages a batch", () => {
    const score = aggregate([
      { hard: 1, soft: 1, gate: 1 },
      { hard: 0, soft: 0, gate: 0 },
    ]);
    expect(score.passes).toBe(1);
    expect(score.hard).toBe(0.5);
    expect(score.runs).toBe(2);
  });
});

describe("schedule", () => {
  it("starts at the full edit budget and ends at one edit", () => {
    expect(learningRateAt(4, 0, 3)).toBe(4);
    expect(learningRateAt(4, 1, 3)).toBe(2);
    expect(learningRateAt(4, 2, 3)).toBe(1);
  });

  it("counts baseline, train, and gate runs", () => {
    expect(
      estimateRuns({ steps: 2, trainBatch: 2, selectionRepeats: 2, slowUpdate: true }),
    ).toEqual({ attempts: 12, optimizer: 3 });
  });
});
