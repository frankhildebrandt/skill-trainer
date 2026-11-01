import { describe, expect, it } from "vitest";
import { applyRunUpdate, toolOutput } from "./run-log";

describe("applyRunUpdate", () => {
  it("joins token deltas without inserting breaks and keeps every character", () => {
    let blocks = applyRunUpdate([], { op: "append", kind: "thinking", text: "The" });
    blocks = applyRunUpdate(blocks, { op: "append", kind: "thinking", text: " user" });
    blocks = applyRunUpdate(blocks, { op: "append", kind: "text", text: "I'll" });
    blocks = applyRunUpdate(blocks, { op: "append", kind: "text", text: " follow" });
    expect(blocks).toEqual([
      { kind: "thinking", text: "The user" },
      { kind: "text", text: "I'll follow" },
    ]);
  });

  it("updates a tool in place and keeps the earlier command", () => {
    let blocks = applyRunUpdate([], {
      op: "tool",
      callId: "c1",
      name: "shell",
      status: "running",
      detail: "go test ./...",
      output: "",
    });
    blocks = applyRunUpdate(blocks, {
      op: "tool",
      callId: "c1",
      name: "shell",
      status: "completed",
      detail: "",
      output: "ok\n",
    });
    expect(blocks).toEqual([
      { kind: "tool", callId: "c1", name: "shell", status: "completed", detail: "go test ./...", output: "ok\n" },
    ]);
  });
});

describe("toolOutput", () => {
  it("unwraps file content, shell output, and file lists", () => {
    expect(toolOutput({ value: { content: "package main\n" } })).toBe("package main\n");
    expect(toolOutput({ value: { stdout: "ok\n", stderr: "" } })).toBe("ok\n");
    expect(toolOutput({ value: { files: ["a.go", "b.go"] } })).toBe("a.go\nb.go");
  });
});
