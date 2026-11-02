import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { codexBinary } from "./codex-config";

export interface CodexNotification {
  method: string;
  params?: any;
}

type RequestHandler = (message: CodexNotification) => unknown | Promise<unknown>;
interface ConnectOptions {
  cwd?: string;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}
interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Owns one newline-delimited app-server connection and its child process. */
export class CodexAppServer {
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(message: CodexNotification) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();
  private readonly lines: Interface;
  private serial = 0;
  private failure: Error | null = null;
  private requestHandler: RequestHandler | undefined;
  private readonly abort: () => void;

  private constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly signal?: AbortSignal) {
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.stdout.on("error", (error) => this.fail(error));
    child.stdin.on("error", (error) => this.fail(error));
    child.on("error", (error) => this.fail(error));
    child.on("exit", (code, signal) => this.fail(new Error(`Codex app-server exited (${signal ?? code ?? "unknown"}).`)));
    child.stderr.resume();
    this.abort = () => {
      this.fail(abortError(signal?.reason));
      child.kill();
    };
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }

  static async connect(options: ConnectOptions = {}): Promise<CodexAppServer> {
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    const args = ["app-server", "--listen", "stdio://"];
    for (const [key, value] of Object.entries(options.config ?? {})) args.push("-c", `${key}=${toml(value)}`);
    const child = spawn(codexBinary(), args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const client = new CodexAppServer(child, options.signal);
    try {
      await client.request("initialize", {
        clientInfo: { name: "skill_trainer", title: "Skill Trainer", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      client.write({ method: "initialized", params: {} });
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  subscribe(listener: (message: CodexNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    if (this.failure) listener(this.failure);
    return () => this.failureListeners.delete(listener);
  }

  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  async close(): Promise<void> {
    this.signal?.removeEventListener("abort", this.abort);
    this.lines.close();
    this.fail(new Error("Codex app-server connection closed."));
    this.listeners.clear();
    this.failureListeners.clear();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 1000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.kill();
    });
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new Error("Codex app-server sent invalid JSON."));
      this.child.kill();
      return;
    }
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        void this.respond(message);
      } else {
        for (const listener of this.listeners) listener(message);
      }
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message || "Codex app-server request failed."));
    else waiting.resolve(message.result);
  }

  private async respond(message: CodexNotification & { id: string | number }): Promise<void> {
    try {
      if (!this.requestHandler) throw new Error(`Unsupported Codex request: ${message.method}`);
      const result = await this.requestHandler(message);
      if (!this.failure) this.write({ id: message.id, result });
    } catch (error) {
      if (!this.failure) this.write({ id: message.id, error: { code: -32601, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    for (const listener of this.failureListeners) listener(error);
  }
}

export function abortError(reason?: unknown): Error {
  const error = new Error(reason instanceof Error ? reason.message : "Codex run cancelled.");
  error.name = "AbortError";
  return error;
}

function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}=${toml(entry)}`).join(",")}}`;
  }
  if (value === null || value === undefined) throw new Error("Codex config overrides must be TOML values.");
  return JSON.stringify(value);
}
