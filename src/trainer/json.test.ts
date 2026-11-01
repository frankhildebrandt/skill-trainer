import { describe, expect, it } from "vitest";
import { extractJson, parseProposal } from "./json";

describe("parseProposal", () => {
  it("reads fenced JSON and drops unknown operations", () => {
    const parsed = parseProposal(
      extractJson(`Here you go
\`\`\`json
{
  "reasoning": "The runs grepped the repo before calling the documented command.",
  "edits": [
    { "op": "append", "content": "Call tilt up first.", "why": "saves search" },
    { "op": "rewrite", "content": "nope" }
  ]
}
\`\`\``),
    );
    expect(parsed.reasoning).toMatch(/tilt|grepped|documented/);
    expect(parsed.edits).toEqual([
      { op: "append", content: "Call tilt up first.", target: "", why: "saves search" },
    ]);
    expect(parsed.files).toEqual([]);
  });
});
