import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityUpdate } from "../shared/run-log";
import { createActivitySink, describeSdkEvent } from "./activity";
import { toolDetail } from "../shared/run-log";

afterEach(() => {
  vi.useRealTimers();
});

describe("describeSdkEvent", () => {
  it("keeps thinking and assistant deltas, including leading spaces", () => {
    expect(describeSdkEvent({ type: "thinking", text: " user" })).toEqual({ kind: "thinking", text: " user" });
    expect(
      describeSdkEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: " follow" }] },
      }),
    ).toEqual({ kind: "text", text: " follow" });
  });

  it("describes a tool call without shortening the argument", () => {
    const command = `go test ${"a".repeat(200)}`;
    expect(
      describeSdkEvent({
        type: "tool_call",
        status: "running",
        name: "shell",
        callId: "call-1\nother",
        args: { command },
      }),
    ).toEqual({ kind: "tool", callId: "call-1", name: "shell", status: "running", detail: command, output: "" });
    expect(toolDetail({ globPattern: "a".repeat(200) })).toBe("a".repeat(200));
  });

  it("reads the finished tool result", () => {
    expect(
      describeSdkEvent({
        type: "tool_call",
        status: "completed",
        name: "read",
        callId: "call-2",
        result: { value: { content: "package main\n" } },
      }),
    ).toMatchObject({ kind: "tool", status: "completed", output: "package main\n" });
    expect(describeSdkEvent({ type: "status", status: "RUNNING" })).toBeNull();
  });
});

describe("createActivitySink", () => {
  it("keeps one thinking block and one answer block", () => {
    vi.useFakeTimers();
    const chunks: ActivityUpdate[] = [];
    const sink = createActivitySink((update) => chunks.push(update));
    sink.thinking("The ");
    sink.thinking("user wants a unit.");
    vi.advanceTimersByTime(250);
    sink.text("I'll");
    sink.text(" follow");
    sink.tool({ callId: "c1", name: "shell", status: "running", detail: "go test", output: "" });
    sink.end();
    expect(chunks).toEqual([
      { op: "append", kind: "thinking", text: "The user wants a unit." },
      { op: "append", kind: "text", text: "I'll follow" },
      { op: "tool", callId: "c1", name: "shell", status: "running", detail: "go test", output: "" },
    ]);
  });
});
