import { describe, expect, it } from "vitest";
import { translate } from "../shared/i18n";
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
  it("localizes skipped reasons while preserving replacement text", () => {
    const result = applyEdits("Alpha\n", [
      { op: "replace", target: "Alpha", content: "$& Remplacement" },
      { op: "replace", target: "missing", content: "Unchanged generated text" },
    ], { limit: 3, translate: (key, values) => translate("fr", key, values) });
    expect(result.skill).toBe("$& Remplacement\n");
    expect(result.skipped[0]?.reason).toBe("Texte cible introuvable");
    expect(result.skipped[0]?.edit.content).toBe("Unchanged generated text");
  });

  it("localizes the learning-rate limit independently of the content", () => {
    const result = applyEdits(skill, [{ op: "append", target: "", content: "Keep this original text." }], {
      limit: 0,
      translate: (key, values) => translate("nl", key, values),
    });
    expect(result.skill).toBe(skill);
    expect(result.skipped[0]?.reason).toBe("Leersnelheid bereikt");
  });

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

  it("uses custom edit length and total growth budgets", () => {
    const content = "x".repeat(3000);
    const edits = [{ op: "append" as const, target: "", content }];
    expect(applyEdits(skill, edits, { limit: 1 }).skipped[0]?.reason).toMatch(/zu lang/);
    expect(applyEdits(skill, edits, { limit: 1, maxEditChars: 4000 }).skipped[0]?.reason).toMatch(/Zeichenbudget/);
    const result = applyEdits(skill, edits, { limit: 1, maxEditChars: 4000, maxAddedChars: 4000 });
    expect(result.applied).toHaveLength(1);
    expect(result.skill).toContain(content);
  });

  it("supports unlimited restructuring including the old slow region", () => {
    const content = "x".repeat(10_000);
    const result = applyEdits(skill, [
      { op: "replace", target: "keep this lesson", content },
      ...Array.from({ length: 8 }, (_, index) => ({ op: "append" as const, target: "", content: `Rule ${index}.` })),
    ], { limit: Infinity, maxEditChars: Infinity, maxAddedChars: Infinity, protectSlowRegion: false });
    expect(result.applied).toHaveLength(9);
    expect(result.skill).not.toContain("keep this lesson");
    expect(result.skill).toContain(content);
  });

  it("protects targets that cross a slow-region boundary", () => {
    const result = applyEdits(skill, [{ op: "delete", target: `parsers.\n\n${SLOW_START}`, content: "" }], { limit: 1 });
    expect(result.applied).toHaveLength(0);
    expect(result.skill).toBe(skill);
  });
});

describe("setSlowRegion", () => {
  it("replaces an existing slow region without touching the procedure", () => {
    const next = setSlowRegion(skill, "Search memory: do not reopen a file you already parsed.");
    expect(next).toContain("Run the build before you edit parsers.");
    expect(next).toContain("Search memory");
    expect(next).not.toContain("keep this lesson");
  });

  it("removes the slow-note length cap when unlimited", () => {
    const lesson = "a".repeat(3000);
    expect(setSlowRegion(skill, lesson, Infinity)).toContain(lesson);
    expect(setSlowRegion(skill, lesson)).not.toContain(lesson);
  });
});
