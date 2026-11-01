import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../shared/types";
import { bundleChanged, measuredImprovement, reportBody, resultTitle } from "./report";

function summary(patch: Partial<SessionSummary> = {}): SessionSummary {
  const score = { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 };
  return {
    originalSkill: "",
    bestSkill: "# New skill",
    baseline: score,
    best: score,
    steps: [],
    rejected: [],
    cancelled: false,
    sessionDir: "session",
    draft: { kind: "create", reasoning: "Added a helper.", skill: "# New skill", files: [] },
    fineTuned: false,
    ...patch,
  };
}

describe("workflow report", () => {
  it("lets users save a draft without claiming a measured improvement", () => {
    const draft = summary();
    expect(bundleChanged(draft)).toBe(true);
    expect(measuredImprovement(draft)).toBe(false);
    expect(resultTitle(draft)).toContain("ungemessen");
    expect(reportBody(draft)).toContain("keine Leistungsmessung");
    expect(reportBody(draft)).not.toContain("0/0");
  });

  it("keeps a prepared draft saveable when fine-tuning fails before a baseline", () => {
    const draft = summary({ error: "Prüfbefehl bereits grün" });
    expect(bundleChanged(draft)).toBe(true);
    expect(resultTitle(draft)).toContain("Entwurf vorbereitet");
    expect(reportBody(draft)).toContain(draft.error);
  });

  it("distinguishes a tested draft from a gated improvement", () => {
    const baseline = { gate: 0.9, hard: 1, soft: 0.33, runs: 2, passes: 2 };
    const draft = summary({ baseline, best: baseline, fineTuned: true });
    expect(resultTitle(draft)).toBe("Entwurf trainiert");
    expect(reportBody(draft)).toContain("keine zusätzliche Verbesserung");
    expect(resultTitle({ ...draft, best: { ...baseline, gate: 0.95 } })).toBe("Bessere Fassung gemessen");
  });

  it("detects companion-file changes even when SKILL.md stays unchanged", () => {
    expect(bundleChanged(summary({
      originalSkill: "# Skill",
      bestSkill: "# Skill",
      originalFiles: [{ path: "references/old.md", text: "old" }],
      bestFiles: [{ path: "scripts/new.sh", text: "new" }],
    }))).toBe(true);
  });

  it("detects when a script was made executable", () => {
    expect(bundleChanged(summary({
      originalSkill: "# Skill",
      bestSkill: "# Skill",
      originalFiles: [{ path: "scripts/run.sh", text: "echo hi" }],
      bestFiles: [{ path: "scripts/run.sh", text: "echo hi", executable: true }],
    }))).toBe(true);
  });
});
