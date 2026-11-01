import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, readProposal } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, lists, and fenced code", () => {
    const blocks = parseMarkdown("# Titel\n\n- eins\n- `zwei`\n\n```\nexit 1\n```\n");
    expect(blocks.map((block) => block.type)).toEqual(["h", "ul", "code"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[2]).toMatchObject({ text: "exit 1" });
  });

  it("renders a markdown table and a table whose rows were joined onto one line", () => {
    const multiline = parseMarkdown("| File | Role |\n|------|------|\n| run.sh | Harness entrypoint |\n| stubs/ | Minimal stubs |\n");
    expect(multiline.map((block) => block.type)).toEqual(["table"]);
    expect(multiline[0]).toMatchObject({
      header: [[{ type: "text", text: "File" }], [{ type: "text", text: "Role" }]],
      rows: [
        [[{ type: "text", text: "run.sh" }], [{ type: "text", text: "Harness entrypoint" }]],
        [[{ type: "text", text: "stubs/" }], [{ type: "text", text: "Minimal stubs" }]],
      ],
    });

    const flat = parseMarkdown(
      "Files\n| File | Role | |------|------| | run.sh | Harness entrypoint | | find.go | Finds new modules, generates overlay/stubs for empty-repo builds, runs probe | | probe.go | Fx load + behavioral proof + named-fact validation | | oracle.go | Deterministic fake DB servers (no network) | | baseline_*.txt | Snapshot of existing discovery modules/operator IDs | | stubs/ | Minimal generated-catalog stubs when modules_gen.go etc. are absent |",
    );
    expect(flat.map((block) => block.type)).toEqual(["p", "table"]);
    const table = flat[1];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") return;
    expect(table.header.map((cell) => cell.map((part) => (part.type === "text" ? part.text : "")).join(""))).toEqual(["File", "Role"]);
    expect(table.rows).toHaveLength(6);
    expect(table.rows[0]?.[0]).toEqual([{ type: "text", text: "run.sh" }]);
    expect(table.rows[5]?.[0]).toEqual([{ type: "text", text: "stubs/" }]);
    expect(table.rows[5]?.[1]?.[0]).toMatchObject({ text: "Minimal generated-catalog stubs when modules_gen.go etc. are absent" });
  });

  it("reads an optimizer proposal with real line breaks in file content", () => {
    const parsed = readProposal('{"reasoning":"knapp","edits":[],"files":[{"op":"write","path":"SKILL.md","content":"# Titel\\n\\nAbsatz"}],"slow":""}');
    expect(parsed?.reasoning).toBe("knapp");
    expect(parsed?.files[0]).toMatchObject({ path: "SKILL.md", content: "# Titel\n\nAbsatz" });
    const split = '{"reasoning":"knapp","files":[{"op":"write","path":"reference.md","content":"# Vertrag\\n{ok}"}]}';
    expect(readProposal(split.slice(0, 48) + split.slice(48))?.files[0]?.content).toBe("# Vertrag\n{ok}");
    expect(readProposal("Der Agent sucht weiter und schreibt keinen Vorschlag.")).toBeNull();
  });

  it("marks strong, emphasis, and code inside a paragraph", () => {
    expect(parseInline("Sieh **genau** auf `npm test` und *dann* weiter.")).toEqual([
      { type: "text", text: "Sieh " },
      { type: "strong", text: "genau" },
      { type: "text", text: " auf " },
      { type: "code", text: "npm test" },
      { type: "text", text: " und " },
      { type: "em", text: "dann" },
      { type: "text", text: " weiter." },
    ]);
  });
});
