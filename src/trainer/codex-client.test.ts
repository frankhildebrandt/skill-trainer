import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./codex-config", () => ({ codexBinary: () => "codex" }));
import { CodexAppServer } from "./codex-client";

let process: ReturnType<typeof fakeProcess>;
let client: CodexAppServer | undefined;

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn(), messages: [] as any[],
  });
  child.kill.mockImplementation(() => { child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM"); return true; });
  child.stdin.on("data", (chunk) => {
    const message = JSON.parse(chunk.toString());
    child.messages.push(message);
    if (message.method === "initialize") queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`));
  });
  return child;
}

beforeEach(() => { process = fakeProcess(); mocks.spawn.mockReturnValue(process); });
afterEach(async () => { await client?.close(); client = undefined; vi.useRealTimers(); });

describe("Codex app-server transport", () => {
  it("initializes the JSONL connection and reconstructs chunked RPC responses", async () => {
    client = await CodexAppServer.connect({ cwd: "/tmp" });
    expect(mocks.spawn).toHaveBeenCalledWith("codex", ["app-server", "--listen", "stdio://"], expect.objectContaining({ shell: false, cwd: "/tmp" }));
    expect(process.messages[0]).toMatchObject({ method: "initialize", params: { capabilities: { experimentalApi: true } } });
    expect(process.messages[1]).toEqual({ method: "initialized", params: {} });
    const result = client.request("model/list", {});
    const id = process.messages.at(-1).id;
    process.stdout.write(`{"id":${id},"res`);
    process.stdout.write('ult":{"data":["model"]}}\n');
    await expect(result).resolves.toEqual({ data: ["model"] });
  });

  it("forwards notifications, handles client-owned tools, and rejects unsupported server requests", async () => {
    client = await CodexAppServer.connect();
    const listener = vi.fn();
    client.subscribe(listener);
    process.stdout.write('{"method":"turn/completed","params":{"threadId":"thread"}}\n');
    expect(listener).toHaveBeenCalledWith({ method: "turn/completed", params: { threadId: "thread" } });
    process.stdout.write('{"id":"approval","method":"item/commandExecution/requestApproval","params":{}}\n');
    await Promise.resolve();
    expect(process.messages.at(-1)).toMatchObject({ id: "approval", error: { code: -32601 } });
    client.setRequestHandler(async () => ({ success: true }));
    process.stdout.write('{"id":"tool","method":"item/tool/call","params":{}}\n');
    await Promise.resolve();
    expect(process.messages.at(-1)).toMatchObject({ id: "tool", result: { success: true } });
  });

  it("rejects pending RPCs and notifies listeners when the process exits", async () => {
    client = await CodexAppServer.connect();
    const failure = vi.fn();
    client.subscribeFailure(failure);
    const result = client.request("thread/start", {});
    process.exitCode = 2;
    process.emit("exit", 2, null);
    await expect(result).rejects.toThrow("exited (2)");
    expect(failure).toHaveBeenCalledOnce();
  });

  it("aborts the process and pending RPCs when its owner is cancelled", async () => {
    const controller = new AbortController();
    client = await CodexAppServer.connect({ signal: controller.signal });
    const result = client.request("account/read", {});
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(process.kill).toHaveBeenCalled();
  });

  it("bounds request waits and rejects malformed JSON", async () => {
    vi.useFakeTimers();
    client = await CodexAppServer.connect();
    const waiting = client.request("account/read", {});
    const expected = expect(waiting).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await expected;
    const pending = client.request("model/list", {});
    process.stdout.write("{invalid}\n");
    await expect(pending).rejects.toThrow("invalid JSON");
    expect(process.kill).toHaveBeenCalled();
  });
});
