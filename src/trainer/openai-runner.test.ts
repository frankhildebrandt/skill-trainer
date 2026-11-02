import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoint, executeCompatibleAgent, listCompatibleModels } from "./openai-runner";
import { deriveSkillFields, executeAgent, proposeWithCursor } from "./cursor-runner";
import type { ExecuteRequest } from "./attempt";

const provider = { kind: "compatible" as const, baseUrl: "http://localhost:8000/v1/", apiKeyEnv: "" };
let root: string;
const fetchMock = vi.fn();
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "compatible-runner-"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
function input(extra: Partial<ExecuteRequest> = {}) {
  return { cwd: root, model: "local-model", prompt: "Do the task", signal: new AbortController().signal, timeoutMs: 5000, provider, ...extra };
}
function reply(content: string | null, tool_calls?: unknown[], finish_reason = tool_calls ? "tool_calls" : "stop") {
  return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content, tool_calls }, finish_reason }] }) };
}
function tool(name: string, args: unknown, id = "call-1") {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
function sent(index = 0) { return JSON.parse(fetchMock.mock.calls[index]![1].body); }

describe("compatible endpoints", () => {
  it("preserves version and proxy prefixes and rejects credentials and non-HTTP URLs", () => {
    expect(endpoint({ kind: "openrouter" }, "models")).toBe("https://openrouter.ai/api/v1/models");
    expect(endpoint(provider, "chat/completions")).toBe("http://localhost:8000/v1/chat/completions");
    for (const baseUrl of ["file:///tmp", "http://user:password@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment"]) {
      expect(() => endpoint({ ...provider, baseUrl }, "models")).toThrow();
    }
  });
  it("loads model IDs and names using the configured key without sending it in the URL", async () => {
    vi.stubEnv("TEST_MODEL_KEY", "test-secret");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "a", name: "Model A" }, { id: "b" }, { name: "invalid" }] }) });
    expect(await listCompatibleModels({ ...provider, apiKeyEnv: "TEST_MODEL_KEY" })).toEqual([{ id: "a", label: "Model A" }, { id: "b", label: "b" }]);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer test-secret");
    expect(fetchMock.mock.calls[0]![0]).not.toContain("test-secret");
  });
  it("fails before making a request if a configured key is missing", async () => {
    vi.stubEnv("TEST_MODEL_KEY", "");
    await expect(listCompatibleModels({ ...provider, apiKeyEnv: "TEST_MODEL_KEY" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("routes a non-Cursor training run through chat completions and executes file tools", async () => {
    fetchMock.mockResolvedValueOnce(reply(null, [tool("write_file", { path: "src/result.txt", content: "done" })])).mockResolvedValueOnce(reply("Finished"));
    const result = await executeAgent(input());
    expect(await fs.readFile(path.join(root, "src/result.txt"), "utf8")).toBe("done");
    expect(result).toMatchObject({ status: "finished", finalText: "Finished", toolCalls: 1 });
    expect(sent(1).messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-1", content: "Written" });
    expect(sent().model).toBe("local-model");
    expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
  });
  it("restricts draft analysis to read tools, including hallucinated writes", async () => {
    await fs.writeFile(path.join(root, "source.txt"), "original");
    fetchMock.mockResolvedValueOnce(reply(null, [tool("read_file", { path: "source.txt" }), tool("write_file", { path: "source.txt", content: "changed" }, "call-2")])).mockResolvedValueOnce(reply("Read"));
    await executeCompatibleAgent({ ...input(), readOnly: true });
    expect(sent().tools.map((row: any) => row.function.name)).toEqual(["list_files", "read_file"]);
    expect(sent(1).messages.at(-1).content).toContain("unavailable");
    expect(await fs.readFile(path.join(root, "source.txt"), "utf8")).toBe("original");
  });
  it("blocks escaping file paths and symlinks and omits shell on empty-repository runs", async () => {
    await fs.symlink(os.tmpdir(), path.join(root, "outside"));
    fetchMock.mockResolvedValueOnce(reply(null, [tool("read_file", { path: "../secret" }), tool("read_file", { path: "outside/secret" }, "call-2")])).mockResolvedValueOnce(reply("Stopped"));
    await executeCompatibleAgent({ ...input(), fs: {} as never });
    expect(sent().tools.some((row: any) => row.function.name === "run_command")).toBe(false);
    expect(sent(1).messages.slice(-2).map((row: any) => row.content)).toEqual(["Path outside workspace", "Symlink paths are unavailable"]);
  });
  it("executes commands and reports activity and the tool count", async () => {
    const activity = vi.fn();
    fetchMock.mockResolvedValueOnce(reply(null, [tool("run_command", { command: "printf hello" })])).mockResolvedValueOnce(reply("Done"));
    expect(await executeCompatibleAgent({ ...input(), onActivity: activity })).toMatchObject({ toolCalls: 1 });
    expect(sent(1).messages.at(-1).content).toBe("Exit: 0\nhello");
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ op: "tool", status: "completed" }));
  });
  it("uses the selected provider for skill-field analysis without tools", async () => {
    fetchMock.mockResolvedValue(reply('{"ziel":"Goal","auftrag":"Task"}'));
    expect(await deriveSkillFields({ provider, model: "local", skill: "skill", files: [], signal: input().signal })).toEqual({ ziel: "Goal", auftrag: "Task" });
    expect(sent()).not.toHaveProperty("tools");
  });
  it("drafts through the configured provider after reading the repository", async () => {
    await fs.writeFile(path.join(root, "source.txt"), "project context");
    const proposal = { reasoning: "Use the project context", edits: [{ op: "append", content: "Read source.txt first." }], slow: null };
    fetchMock.mockResolvedValueOnce(reply(null, [tool("read_file", { path: "source.txt" })]))
      .mockResolvedValueOnce(reply(JSON.stringify(proposal)));
    const result = await proposeWithCursor({
      provider, model: "local-optimizer", cwd: root, workspacePath: root,
      skill: "# Skill", files: [{ path: "SKILL.md", text: "# Skill" }],
      kind: "pretrain", learningRate: 1, train: [], rejected: [], emptyGate: false,
      skillScope: "general", auftrag: "Improve the skill", signal: input().signal,
    });
    expect(result.reasoning).toBe(proposal.reasoning);
    expect(sent().model).toBe("local-optimizer");
    expect(sent(1).messages.at(-1).content).toBe("project context");
    expect(sent().tools.map((row: any) => row.function.name)).toEqual(["list_files", "read_file"]);
  });
  it("does not return partial or malformed completions as successful", async () => {
    fetchMock.mockResolvedValueOnce(reply("truncated", undefined, "length")).mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(executeCompatibleAgent(input())).rejects.toThrow();
    await expect(executeCompatibleAgent(input())).rejects.toThrow();
  });
  it("does not expose HTTP error bodies", async () => {
    const body = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: body });
    await expect(executeCompatibleAgent(input())).rejects.toThrow();
    expect(body).not.toHaveBeenCalled();
  });
  it("cancels before a request and while a request is pending", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await executeCompatibleAgent(input({ signal: controller.signal }))).toMatchObject({ status: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason));
    }));
    expect(await executeCompatibleAgent(input({ timeoutMs: 10 }))).toMatchObject({ status: "cancelled" });
  });
});
