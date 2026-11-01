import { describe, expect, it } from "vitest";
import { changedLines } from "./text-diff";

describe("changedLines", () => {
  it("shows only the lines that differ", () => {
    expect(changedLines("a\nb\nc\n", "a\nB\nc\n")).toBe("- b\n+ B");
  });

  it("is empty when the text matches", () => {
    expect(changedLines("same\n", "same\n")).toBe("");
  });
});
