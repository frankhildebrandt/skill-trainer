import fs from "node:fs/promises";
import path from "node:path";
import type { ActivityUpdate } from "../shared/run-log";
import { createActivitySink } from "./activity";
import type { AgentTrace, ExecuteRequest } from "./attempt";
import { abortError, CodexAppServer, type CodexNotification } from "./codex-client";
import { inferenceConfig, isolatedThreadConfig, requireCodexVersion } from "./codex-config";
import { codexFileTools } from "./codex-tools";

interface TurnInput extends ExecuteRequest {
  readOnly?: boolean;
  outputSchema?: unknown;
}

/** Runs a fresh ephemeral Codex conversation and maps its events to trainer activity. */
export async function runCodexTurn(input: TurnInput): Promise<AgentTrace & { sawRead: boolean }> {
  if (input.signal.aborted) throw abortError(input.signal.reason);
  await requireCodexVersion();
  const started = Date.now();
  const timed = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  if (timed.aborted) throw abortError(timed.reason);
  const nativeEnvironment = !input.fs && !input.readOnly;
  const client = await CodexAppServer.connect({ cwd: input.cwd, signal: timed, config: inferenceConfig(nativeEnvironment) });
  const files = input.fs ? codexFileTools(input.fs, Boolean(input.readOnly), input.cwd) : undefined;
  const activity = turnActivity(input.onActivity);
  let stop: (() => void) | undefined;
  let stopFailure: (() => void) | undefined;
  try {
    const config = await isolatedThreadConfig(client, input.cwd);
    const thread = await client.request<{ thread: { id: string } }>("thread/start", {
      model: input.model, cwd: input.cwd, ephemeral: true,
      approvalPolicy: "never", sandbox: input.readOnly ? "read-only" : "workspace-write",
      config, ...(nativeEnvironment ? {} : { environments: [] }),
      ...(files ? { dynamicTools: files.specs } : {}),
      developerInstructions: "Use only the tools supplied by Skill Trainer. Never access any path outside the supplied repository. Follow any project AGENTS.md instructions provided in the user prompt.",
    });
    const threadId = thread.thread.id;
    if (!threadId) throw new Error("Codex app-server returned no thread ID.");
    client.setRequestHandler(async (message) => {
      if (message.method !== "item/tool/call" || !files || message.params?.threadId !== threadId) {
        throw new Error(`Unsupported Codex request: ${message.method}`);
      }
      const params = message.params;
      activity.customToolStart(params.callId, params.tool, params.arguments);
      const result = await files.call(params.tool, params.arguments);
      activity.customTool(params.callId, params.tool, params.arguments, result);
      return result;
    });
    const completed = new Promise<any>((resolve, reject) => {
      stop = client.subscribe((message) => {
        if (message.params?.threadId !== threadId) return;
        activity.receive(message);
        if (message.method === "turn/completed") resolve(message.params.turn);
      });
      stopFailure = client.subscribeFailure(reject);
    });
    // Attach before starting: the process can exit while turn/start is pending.
    void completed.catch(() => undefined);
    const projectInstructions = input.settingSources?.includes("project") ? await readProjectInstructions(input.cwd) : "";
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${projectInstructions}${input.prompt}` }],
      approvalPolicy: "never",
      sandboxPolicy: input.readOnly
        ? { type: "readOnly", networkAccess: false }
        : { type: "workspaceWrite", writableRoots: [input.cwd], networkAccess: nativeEnvironment, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    });
    const turn = await completed;
    const status = turn.status === "completed" ? "finished" : turn.status === "interrupted" ? "cancelled" : "error";
    return {
      status, toolCalls: activity.tools(),
      transcript: activity.transcript().slice(0, 8000), durationMs: Date.now() - started,
      error: turn.error?.message ?? (status === "error" ? `Codex turn ended with status ${turn.status}.` : undefined),
      sawRead: files?.sawRead ?? false,
      finalText: activity.finalText(),
    };
  } finally {
    stop?.();
    stopFailure?.();
    activity.end();
    await client.close();
  }
}

function turnActivity(onActivity?: (update: ActivityUpdate) => void) {
  const notes: string[] = [];
  const text = new Map<string, string>();
  const phases = new Map<string, string>();
  const completedTools = new Set<string>();
  const sink = createActivitySink((update) => {
    onActivity?.(update);
    if (notes.length >= 80) return;
    if (update.op === "tool" && update.status === "running") notes.push(`${update.name} ${update.detail}`.slice(0, 500));
    if (update.op === "note") notes.push(update.text.slice(0, 500));
  });
  function tool(id: string, name: string, detail: string, output: string, status: "running" | "completed" | "error") {
    if (status !== "running") completedTools.add(id);
    sink.tool({ callId: id, name, detail, output, status });
  }
  return {
    end: () => sink.end(),
    transcript: () => notes.join("\n"),
    tools: () => completedTools.size,
    finalText: () => {
      const final = [...text].filter(([id]) => phases.get(id) === "final_answer");
      return (final.length ? final : [...text]).map(([, value]) => value).join("\n");
    },
    customToolStart(id: string, name: string, args: any) {
      tool(id, name, args?.path ?? args?.pattern ?? "", "", "running");
    },
    customTool(id: string, name: string, args: any, result: { success: boolean; contentItems: Array<{ text: string }> }) {
      tool(id, name, args?.path ?? args?.pattern ?? "", result.contentItems.map((item) => item.text).join("\n"), result.success ? "completed" : "error");
    },
    receive(message: CodexNotification) {
      const p = message.params;
      if (message.method === "item/agentMessage/delta") {
        text.set(p.itemId, (text.get(p.itemId) ?? "") + p.delta);
        sink.text(p.delta);
      } else if (message.method === "item/reasoning/summaryTextDelta" || message.method === "item/reasoning/textDelta") {
        sink.thinking(p.delta);
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = p.item;
        if (!item) return;
        if (item.type === "agentMessage") {
          phases.set(item.id, item.phase ?? "");
          if (message.method === "item/completed" && typeof item.text === "string") {
            if (!text.has(item.id)) sink.text(item.text);
            text.set(item.id, item.text);
          }
          return;
        }
        if (!["commandExecution", "fileChange", "mcpToolCall", "webSearch", "collabAgentToolCall"].includes(item.type)) return;
        const status = message.method === "item/started" ? "running" : ["failed", "declined"].includes(item.status) || item.success === false ? "error" : "completed";
        tool(item.id, item.tool ?? item.type, item.command ?? item.arguments?.path ?? "", item.aggregatedOutput ?? "", status);
      } else if (message.method === "error") {
        sink.note(p.error?.message ?? "Codex reported an error.");
      }
    },
  };
}

async function readProjectInstructions(cwd: string): Promise<string> {
  const file = path.join(cwd, "AGENTS.md");
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile()) return "";
  return `Project instructions (AGENTS.md):\n${(await fs.readFile(file, "utf8")).slice(0, 32_768)}\n\n`;
}
