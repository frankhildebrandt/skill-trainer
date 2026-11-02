import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ turn: vi.fn() }));
vi.mock("./codex-turn", () => ({ runCodexTurn: mocks.turn }));
import { deriveFieldsWithCodex, executeWithCodex, proposeWithCodex } from "./codex-runner";

beforeEach(() => { mocks.turn.mockReset(); });
const trace = { status: "finished", finalText: '{"reasoning":"Improve","edits":[],"files":[],"slow":""}', toolCalls: 0, transcript: "", durationMs: 10, sawRead: false };
function proposal() {
  return { kind: "step" as const, skill: "# Skill", files: [], emptyGate: false, skillScope: "general" as const, auftrag: "Do the task.", train: [], rejected: [], learningRate: 2, model: "codex-test", cwd: "/tmp", signal: new AbortController().signal };
}

describe("Codex inference workflows", () => {
  it("routes target execution and clips only the stored training summary", async () => {
    mocks.turn.mockResolvedValue({ ...trace, finalText: "a".repeat(6000) });
    expect((await executeWithCodex({ cwd: "/tmp", model: "codex-test", prompt: "Do it", signal: new AbortController().signal, timeoutMs: 1000 })).finalText).toHaveLength(4000);
  });

  it("returns a cancelled attempt on timeout so one target timeout does not abort the session", async () => {
    mocks.turn.mockRejectedValue(Object.assign(new Error("Timed out"), { name: "AbortError" }));
    expect(await executeWithCodex({ cwd: "/tmp", model: "codex-test", prompt: "Do it", signal: new AbortController().signal, timeoutMs: 1000 })).toMatchObject({ status: "cancelled" });
    await expect(proposeWithCodex(proposal())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("parses optimizer output without clipping large file edits and supplies no file tools", async () => {
    const content = "x".repeat(6000);
    mocks.turn.mockResolvedValue({ ...trace, finalText: JSON.stringify({ reasoning: "", files: [{ op: "write", path: "SKILL.md", content }] }) });
    expect((await proposeWithCodex(proposal())).files?.[0]?.content).toBe(content);
    expect(mocks.turn.mock.calls[0][0]).toMatchObject({ readOnly: true, settingSources: [] });
    expect(mocks.turn.mock.calls[0][0].fs).toBeUndefined();
  });

  it("requires actual repository inspection before accepting a draft", async () => {
    mocks.turn.mockResolvedValueOnce(trace).mockResolvedValueOnce({ ...trace, sawRead: true });
    expect(await proposeWithCodex({ ...proposal(), kind: "create", workspacePath: "/tmp" })).toMatchObject({ reasoning: "Improve" });
    expect(mocks.turn).toHaveBeenCalledTimes(2);
    expect(mocks.turn.mock.calls[0][0].fs).toBeDefined();
    mocks.turn.mockResolvedValue(trace);
    await expect(proposeWithCodex({ ...proposal(), kind: "pretrain", workspacePath: "/tmp" })).rejects.toMatchObject({ key: "runner.unreadCodebase" });
  });

  it("derives localized fields without file tools and rejects failed inference", async () => {
    mocks.turn.mockResolvedValue({ ...trace, finalText: '{"ziel":"Explain parsing.","auftrag":"Parse an input."}' });
    expect(await deriveFieldsWithCodex({ model: "codex-test", skill: "# Parser", files: [], signal: new AbortController().signal, locale: "en" })).toEqual({ ziel: "Explain parsing.", auftrag: "Parse an input." });
    expect(mocks.turn.mock.calls[0][0]).toMatchObject({ readOnly: true, settingSources: [], prompt: expect.stringContaining("in English") });
    mocks.turn.mockResolvedValue({ ...trace, status: "error", error: "Rate limit" });
    await expect(proposeWithCodex(proposal())).rejects.toThrow("Rate limit");
  });
});
