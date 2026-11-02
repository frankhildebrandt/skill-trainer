import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderConfig } from "../shared/provider";
import { restoreProvider } from "../shared/provider";
import { LocalizedError } from "../shared/localized-error";
import type { ModelOption } from "../shared/types";
import type { AgentTrace, ExecuteRequest } from "./attempt";
import { runVerify } from "./verify";

export function endpoint(config: ProviderConfig, resource: string): string {
  const provider = restoreProvider(config);
  let url: URL;
  try {
    url = new URL(provider.baseUrl!.trim().replace(/\/+$/, "") + "/");
  } catch {
    throw new LocalizedError("provider.invalidUrl");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new LocalizedError("provider.invalidUrl");
  }
  return new URL(resource, url).href;
}

function headers(config: ProviderConfig): Record<string, string> {
  const env = restoreProvider(config).apiKeyEnv?.trim();
  const key = env ? process.env[env]?.trim() : undefined;
  if (env && !key) throw new LocalizedError("provider.missingKey", { name: env });
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

async function request(config: ProviderConfig, resource: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(endpoint(config, resource), {
    method: body === undefined ? "GET" : "POST",
    headers: headers(config), signal, redirect: "error",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Response bodies can contain credentials or echoed prompts. Keep HTTP errors out of logs.
  if (!response.ok) throw new LocalizedError("provider.httpError", { status: response.status });
  return response.json();
}

export async function listCompatibleModels(config: ProviderConfig): Promise<ModelOption[]> {
  const reply = await request(config, "models", AbortSignal.timeout(15_000)) as { data?: Array<{ id?: unknown; name?: unknown }> };
  if (!Array.isArray(reply.data)) throw new LocalizedError("provider.invalidResponse");
  return reply.data.filter((item) => typeof item.id === "string").map((item) => ({
    id: item.id as string, label: typeof item.name === "string" ? item.name : item.id as string,
  }));
}

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

const DEFINITIONS = [
  { name: "list_files", description: "List a directory in the workspace. Start with path '.'.", properties: { path: { type: "string" } }, required: ["path"] },
  { name: "read_file", description: "Read a UTF-8 workspace file.", properties: { path: { type: "string" } }, required: ["path"] },
  { name: "write_file", description: "Write a complete UTF-8 workspace file, creating parent directories.", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  { name: "delete_file", description: "Delete a workspace file.", properties: { path: { type: "string" } }, required: ["path"] },
  { name: "run_command", description: "Run a shell command in the workspace.", properties: { command: { type: "string" } }, required: ["command"] },
];

/** Resolve every existing ancestor to prevent file tools following symlinks out of the workspace. */
async function locate(root: string, value: unknown): Promise<string> {
  if (typeof value !== "string") throw new Error("path must be a string");
  const file = path.resolve(root, value);
  if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Path outside workspace");
  let current = root;
  for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Symlink paths are unavailable");
  }
  return file;
}

export async function executeCompatibleAgent(
  input: ExecuteRequest & { provider: ProviderConfig; readOnly?: boolean; noTools?: boolean },
): Promise<AgentTrace> {
  const started = Date.now();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  const root = await fs.realpath(input.cwd);
  const tools = input.noTools ? [] : DEFINITIONS.filter((tool) =>
    (!input.readOnly || ["list_files", "read_file"].includes(tool.name)) && (!input.fs || tool.name !== "run_command"),
  );
  const allowed = new Set(tools.map((tool) => tool.name));
  const messages: Message[] = [{ role: "user", content: input.prompt }];
  const notes: string[] = [];
  let toolCalls = 0;
  try {
    for (let turn = 0; turn < 100; turn += 1) {
      signal.throwIfAborted();
      const reply = await request(input.provider, "chat/completions", signal, {
        model: input.model, messages, stream: false,
        ...(tools.length ? { tools: tools.map(({ name, description, properties, required }) => ({
          type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
        })) } : {}),
      }) as { choices?: Array<{ finish_reason?: string; message?: Message }> };
      const choice = reply.choices?.[0];
      const message = choice?.message;
      if (!message || (message.content != null && typeof message.content !== "string") ||
        (message.tool_calls != null && !Array.isArray(message.tool_calls))) throw new LocalizedError("provider.invalidResponse");
      const calls = message.tool_calls ?? [];
      if (calls.some((call) => !call?.id || call.type !== "function" || typeof call.function?.name !== "string" || typeof call.function.arguments !== "string")) {
        throw new LocalizedError("provider.invalidResponse");
      }
      messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (message.content) {
        input.onActivity?.({ op: "append", kind: "text", text: message.content });
        notes.push(message.content);
      }
      if (!calls.length) {
        if (choice?.finish_reason !== "stop" || !message.content?.trim()) throw new LocalizedError("provider.incomplete");
        return { status: "finished", finalText: message.content, toolCalls, transcript: notes.join("\n").slice(-8000), durationMs: Date.now() - started };
      }
      for (const call of calls) {
        signal.throwIfAborted();
        const name = call.function.name;
        const detail = call.function.arguments.slice(0, 500);
        input.onActivity?.({ op: "tool", callId: call.id, name, status: "running", detail, output: "" });
        let output: string;
        let failed = false;
        try {
          if (!allowed.has(name)) throw new Error("Tool unavailable");
          const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
          if (name === "run_command") {
            if (typeof args.command !== "string") throw new Error("command must be a string");
            const result = await runVerify(args.command, root, Math.min(input.timeoutMs, 120_000), signal);
            output = `Exit: ${result.exitCode}\n${result.output}`;
          } else {
            const file = await locate(root, args.path);
            if (name === "list_files") {
              output = (await fs.readdir(file, { withFileTypes: true })).slice(0, 2000)
                .map((entry) => entry.name + (entry.isDirectory() ? "/" : entry.isSymbolicLink() ? " [symlink]" : "")).join("\n");
            } else if (name === "read_file") {
              const stat = await fs.stat(file);
              if (stat.size > 2_000_000) throw new Error("File too large; use smaller files");
              output = await fs.readFile(file, "utf8");
            } else if (name === "write_file") {
              if (typeof args.content !== "string") throw new Error("content must be a string");
              await fs.mkdir(path.dirname(file), { recursive: true });
              await fs.writeFile(file, args.content);
              output = "Written";
            } else {
              await fs.unlink(file);
              output = "Deleted";
            }
          }
        } catch (error) {
          signal.throwIfAborted();
          failed = true;
          output = error instanceof Error ? error.message : String(error);
        }
        toolCalls += 1;
        notes.push(`${name} ${detail}\n${output.slice(0, 500)}`);
        input.onActivity?.({ op: "tool", callId: call.id, name, status: failed ? "error" : "completed", detail, output: output.slice(0, 4000) });
        messages.push({ role: "tool", tool_call_id: call.id, content: output.slice(0, 100_000) });
      }
    }
    throw new LocalizedError("provider.toolLimit");
  } catch (error) {
    if (signal.aborted) return { status: "cancelled", finalText: "", toolCalls, transcript: notes.join("\n").slice(-8000), durationMs: Date.now() - started };
    throw error;
  }
}
