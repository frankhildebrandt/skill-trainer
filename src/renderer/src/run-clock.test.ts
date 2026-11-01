import { describe, expect, it } from "vitest";
import { runDuration } from "./run-clock";

describe("runDuration", () => {
  it("freezes a settled run when the session clock keeps ticking", () => {
    const startedAt = 1_000;
    const endedAt = 61_400;
    const run = { startedAt, endedAt };
    expect(runDuration(run, endedAt)).toBe("1m 00s");
    expect(runDuration(run, endedAt + 120_000)).toBe("1m 00s");
  });

  it("keeps counting while a run has no end", () => {
    const run = { startedAt: 1_000 };
    expect(runDuration(run, 126_000)).toBe("2m 05s");
  });
});