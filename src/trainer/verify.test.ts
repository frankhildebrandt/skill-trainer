import { describe, expect, it } from "vitest";
import { runVerify } from "./verify";

describe("runVerify", () => {
  it("records the command exit code", async () => {
    const ok = await runVerify("node -e \"process.exit(0)\"", process.cwd(), 10_000, new AbortController().signal);
    const bad = await runVerify("node -e \"process.exit(3)\"", process.cwd(), 10_000, new AbortController().signal);
    expect(ok.exitCode).toBe(0);
    expect(bad.exitCode).toBe(3);
  });
});
