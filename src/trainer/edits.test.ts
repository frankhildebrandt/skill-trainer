import { describe, expect, it } from "vitest";
import { applyEdits, setSlowRegion, SLOW_END, SLOW_START } from "./edits";

const skill = `---
name: demo
---

# Demo

Run the build before you edit parsers.

<!-- skill-trainer:slow -->
keep this lesson
<!-- /skill-trainer:slow -->
`;

describe("applyEdits", () => {
  it("applies a unique replace and skips an ambiguous one", () => {
    const result = applyEdits(
      `${skill}\nCheck the log.\nCheck the log.\n`,
      [
        {
          op: "replace",
          target: "Run the build before you edit parsers.",
          content: "Run `npm test` before you edit parsers.",
        },
        {
          op: "delete",
          target: "Check the log.",
          content: "",
        },
      ],
      { limit: 4 },
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skill).toContain("Run `npm test` before you edit parsers.");
    expect(result.skipped[0]?.reason).toMatch(/eindeutig/);
  });

  it("does not let a step edit rewrite the slow region", () => {
    const result = applyEdits(
      skill,
      [{ op: "replace", target: "keep this lesson", content: "overwritten" }],
      { limit: 2 },
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skill).toContain("keep this lesson");
  });

  it("appends ahead of the slow region and clips to the learning rate", () => {
    const result = applyEdits(
      skill,
      [
        { op: "append", target: "", content: "First rule." },
        { op: "append", target: "", content: "Second rule." },
      ],
      { limit: 1 },
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/Lernrate/);
    const slowAt = result.skill.indexOf(SLOW_START);
    expect(result.skill.indexOf("First rule.")).toBeLessThan(slowAt);
    expect(result.skill).toContain(SLOW_END);
  });

  it("inserts after a unique anchor", () => {
    const result = applyEdits(
      "Alpha\nBeta\n",
      [{ op: "insert_after", target: "Alpha", content: "Between" }],
      { limit: 1 },
    );
    expect(result.skill).toBe("Alpha\nBetween\nBeta\n");
  });
});

describe("setSlowRegion", () => {
  it("replaces an existing slow region without touching the procedure", () => {
    const next = setSlowRegion(skill, "Search memory: do not reopen a file you already parsed.");
    expect(next).toContain("Run the build before you edit parsers.");
    expect(next).toContain("Search memory");
    expect(next).not.toContain("keep this lesson");
  });
});
