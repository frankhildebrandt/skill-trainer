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

  it("reads a proposal whose file content contains markdown code fences", () => {
    const proposal = {
      reasoning: "Skill carries its own layout.",
      edits: [],
      files: [{ op: "write", path: "SKILL.md", content: "# Layout\n\n```\nmodules/discovery/<vendor>/\n  module.json\n```\n\n```sh\ngo test ./...\n```\n" }],
      slow: "",
    };
    const parsed = parseProposal(extractJson(JSON.stringify(proposal)));
    expect(parsed.reasoning).toBe("Skill carries its own layout.");
    expect(parsed.files?.[0]?.content).toContain("go test ./...");
  });

  it("parses full rewrites, executable scripts, and companion deletions", () => {
    const result = parseProposal({ files: [
      { op: "write", path: "SKILL.md", content: "# New skill" },
      { op: "write", path: "scripts/run.sh", content: "#!/bin/sh\necho ok", executable: true },
      { op: "delete", path: "references/old.md" },
      { op: "write", path: "../escape", content: "bad" },
      { op: "write", path: "C:\\escape", content: "bad" },
      { op: "write", path: ".git/config", content: "bad" },
    ] });
    expect(result.files).toHaveLength(3);
    expect(result.files?.[0]).toMatchObject({ op: "write", path: "SKILL.md" });
    expect(result.files?.[1]).toMatchObject({ executable: true });
    expect(result.files?.[2]).toMatchObject({ op: "delete", path: "references/old.md", content: "" });
  });
});
