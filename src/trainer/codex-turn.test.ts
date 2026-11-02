import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexNotification } from "./codex-client";
import { rootedFs } from "./rooted-fs";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), version: vi.fn(), config: vi.fn() }));
vi.mock("./codex-client", () => ({
  CodexAppServer: { connect: mocks.connect },
  abortError: () => Object.assign(new Error("Cancelled"), { name: "AbortError" }),
}));
vi.mock("./codex-config", async (original) => ({
  ...await original<typeof import("./codex-config")>(),
  requireCodexVersion: mocks.version,
  isolatedThreadConfig: mocks.config,
}));
import { runCodexTurn } from "./codex-turn";

let root: string;
let listener: (message: CodexNotification) => void;
let failure: (error: Error) => void;
let handler: (message: CodexNotification) => Promise<unknown>;
let start: () => Promise<void>;
const client = { request: vi.fn(), close: vi.fn(), subscribe: vi.fn(), subscribeFailure: vi.fn(), setRequestHandler: vi.fn() };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-turn-"));
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(client);
  mocks.version.mockResolvedValue(undefined);
  mocks.config.mockResolvedValue({ "skills.config": [] });
  client.subscribe.mockImplementation((cb) => { listener = cb; return vi.fn(); });
  client.subscribeFailure.mockImplementation((cb) => { failure = cb; return vi.fn(); });
  client.setRequestHandler.mockImplementation((cb) => { handler = cb; });
  client.request.mockImplementation(async (method) => {
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "turn/start") { await start(); return { turn: { id: "turn" } }; }
    throw new Error(`Unexpected method ${method}`);
  });
  start = async () => { emit("turn/completed", { turn: { status: "completed" } }); };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function emit(method: string, params: Record<string, unknown>) { listener({ method, params: { threadId: "thread", ...params } }); }
function input() { return { cwd: root, model: "codex-test", prompt: "Fix the code.", signal: new AbortController().signal, timeoutMs: 1000 }; }

describe("Codex turn lifecycle", () => {
  it("maps final text, reasoning, tool activity, and terminal status", async () => {
    const activity = vi.fn();
    start = async () => {
      emit("item/reasoning/summaryTextDelta", { delta: "Inspecting." });
      emit("item/agentMessage/delta", { itemId: "comment", delta: "Working." });
      emit("item/completed", { item: { type: "agentMessage", id: "comment", text: "Working.", phase: "commentary" } });
      emit("item/started", { item: { type: "commandExecution", id: "tool", command: "npm test", status: "inProgress" } });
      emit("item/completed", { item: { type: "commandExecution", id: "tool", command: "npm test", status: "completed", aggregatedOutput: "passed" } });
      emit("item/agentMessage/delta", { itemId: "answer", delta: "Done." });
      emit("item/completed", { item: { type: "agentMessage", id: "answer", text: "Done.", phase: "final_answer" } });
      emit("turn/completed", { turn: { status: "completed" } });
    };
    const trace = await runCodexTurn({ ...input(), onActivity: activity });
    expect(trace).toMatchObject({ status: "finished", finalText: "Done.", toolCalls: 1 });
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ op: "append", kind: "thinking", text: "Inspecting." }));
    expect(client.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ sandbox: "workspace-write", approvalPolicy: "never" }));
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("disables native environments for empty gates and counts custom tools once", async () => {
    await fs.writeFile(path.join(root, "README.md"), "repository");
    start = async () => {
      const result = await handler({ method: "item/tool/call", params: { threadId: "thread", callId: "call-id", tool: "skill_trainer_read_file", arguments: { path: "README.md" } } });
      expect(result).toMatchObject({ success: true });
      emit("item/completed", { item: { type: "dynamicToolCall", id: "different-item-id", tool: "skill_trainer_read_file", status: "completed", success: true } });
      emit("turn/completed", { turn: { status: "completed" } });
    };
    const trace = await runCodexTurn({ ...input(), fs: rootedFs(root) });
    expect(trace).toMatchObject({ toolCalls: 1, sawRead: true });
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ "features.shell_tool": false, "features.view_image": false }) }));
    expect(client.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ environments: [], dynamicTools: expect.arrayContaining([expect.objectContaining({ name: "skill_trainer_write_file" })]) }));
  });

  it("uses no write file tools and a read-only sandbox while inspecting a project", async () => {
    await runCodexTurn({ ...input(), fs: rootedFs(root), readOnly: true });
    const thread = client.request.mock.calls.find(([method]) => method === "thread/start")?.[1];
    expect(thread).toMatchObject({ sandbox: "read-only", environments: [] });
    expect(thread.dynamicTools.map((tool: any) => tool.name)).not.toContain("skill_trainer_write_file");
    expect(client.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ sandboxPolicy: { type: "readOnly", networkAccess: false } }));
  });

  it("returns turn failures and rejects process failures while always disposing the process", async () => {
    start = async () => { emit("turn/completed", { turn: { status: "failed", error: { message: "Access denied" } } }); };
    expect(await runCodexTurn(input())).toMatchObject({ status: "error", error: "Access denied" });
    start = async () => { failure(new Error("process died")); };
    await expect(runCodexTurn(input())).rejects.toThrow("process died");
    expect(client.close).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported Codex versions before starting a thread", async () => {
    mocks.version.mockRejectedValueOnce(new Error("update Codex"));
    await expect(runCodexTurn(input())).rejects.toThrow("update Codex");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
