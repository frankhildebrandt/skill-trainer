import { LocalizedError, localizedMessage } from "../shared/localized-error";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { translate, type Locale } from "../shared/i18n";
import { Agent, type ConversationTurn, type SDKAgentInfo } from "@cursor/sdk";
import {
  cursorProjectSlug,
  dedupeRuns,
  messageText,
  parseRemotes,
  parseWorktrees,
  runsFromMessages,
  sameRepo,
  withSearchPrefix,
  type ChatTurn,
  type CursorRunCatalog,
  type CursorRunOption,
} from "../shared/cursor-runs";

const MAX_FILE_BYTES = 2_000_000;
const MAX_RUNS = 500;
const MAX_CLOUD_AGENTS = 20;
const MAX_CLOUD_PAGES = 6;

export interface ListedAgent {
  agentId: string;
  name: string;
  summary: string;
  repos: string[];
  lastModified: number | null;
}

export interface ListedRun {
  id: string;
  createdAt: number | null;
  messages: ChatTurn[];
}

export interface RepoRunDeps {
  projectsRoot: string;
  checkouts: (workspacePath: string) => Promise<{ paths: string[]; remotes: string[] }>;
  localAgents: (cwd: string) => Promise<ListedAgent[]>;
  localMessages: (agentId: string, cwd: string) => Promise<ChatTurn[]>;
  cloudAgents: () => Promise<ListedAgent[]>;
  cloudRuns: (agentId: string) => Promise<ListedRun[]>;
}

export async function listRepoRuns(
  workspacePath: string,
  deps: RepoRunDeps = defaultDeps(),
  scope: "all" | "local" | "cloud" = "all",
  locale: Locale = "de",
): Promise<CursorRunCatalog> {
  const resolved = path.resolve(workspacePath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(translate(locale, "runs.projectRequired"));

  const warnings: string[] = [];
  const repo = await deps.checkouts(resolved).catch(() => ({ paths: [resolved], remotes: [] as string[] }));
  const paths = repo.paths.length > 0 ? repo.paths : [resolved];
  const wantLocal = scope !== "cloud";
  const wantCloud = scope !== "local";

  const localTranscripts = wantLocal ? (await Promise.all(paths.map(async (checkout) => {
    try {
      return await readCheckoutTranscripts(checkout, deps.projectsRoot);
    } catch (err) {
      warnings.push(translate(locale, "runs.localRunsError", { checkout: path.basename(checkout), message: messageOf(err, locale) }));
      return [];
    }
  }))).flat() : [];

  const localSdk: CursorRunOption[] = [];
  if (wantLocal) {
    for (const checkout of paths) {
      try {
        const agents = await deps.localAgents(checkout);
        for (const agent of agents) {
          const messages = await deps.localMessages(agent.agentId, checkout).catch(() => [] as ChatTurn[]);
          localSdk.push(...agentRuns(agent, messages, "local", path.basename(checkout)));
        }
      } catch (err) {
        warnings.push(translate(locale, "runs.localAgentsError", { checkout: path.basename(checkout), message: messageOf(err, locale) }));
      }
    }
  }

  let cloud: CursorRunOption[] = [];
  if (wantCloud && repo.remotes.length === 0) {
    warnings.push(translate(locale, "runs.noRemote"));
  } else if (wantCloud) {
    try {
      cloud = await cloudRunsForRemotes(repo.remotes, deps, warnings, locale);
    } catch (err) {
      warnings.push(translate(locale, "runs.cloudError", { message: messageOf(err, locale) }));
    }
  }

  let runs = dedupeRuns([...localTranscripts, ...localSdk, ...cloud]);
  if (runs.length > MAX_RUNS) {
    runs = runs.slice(0, MAX_RUNS);
    warnings.push(translate(locale, "runs.latestRuns", { count: MAX_RUNS.toLocaleString(locale) }));
  }
  return { workspacePath: resolved, runs, warnings };
}

export async function readCheckoutTranscripts(checkout: string, projectsRoot: string): Promise<CursorRunOption[]> {
  const dir = path.join(projectsRoot, cursorProjectSlug(path.resolve(checkout)), "agent-transcripts");
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const place = path.basename(path.resolve(checkout));
  const runs: CursorRunOption[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "subagents") continue;
    const file = entry.isDirectory()
      ? path.join(dir, entry.name, `${entry.name}.jsonl`)
      : entry.isFile() && entry.name.endsWith(".jsonl")
        ? path.join(dir, entry.name)
        : null;
    if (!file) continue;
    try {
      const stat = await fs.stat(file);
      const messages = parseTranscript(await readCapped(file, stat.size));
      const idPrefix = path.basename(file, ".jsonl");
      runs.push(...runsFromMessages({
        idPrefix,
        runtime: "local",
        messages,
        place,
        createdAt: Math.trunc(stat.mtimeMs),
      }));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }
  return runs;
}

export function parseTranscript(text: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as { role?: unknown; message?: unknown };
      if (value.role !== "user" && value.role !== "assistant") continue;
      const body = messageText(value.message ?? value);
      if (!body) continue;
      turns.push({ role: value.role, text: body });
    } catch {
      // A truncated last line is not a run.
    }
  }
  return turns;
}

function agentRuns(agent: ListedAgent, messages: ChatTurn[], runtime: "local" | "cloud", place: string): CursorRunOption[] {
  const source = messages.length > 0
    ? messages
    : [{ role: "user" as const, text: agent.summary.trim() || agent.name.trim() }];
  return withSearchPrefix(runsFromMessages({
    idPrefix: agent.agentId,
    runtime,
    messages: source,
    place,
    createdAt: agent.lastModified,
  }), agent.name);
}

async function cloudRunsForRemotes(remotes: string[], deps: RepoRunDeps, warnings: string[], locale: Locale): Promise<CursorRunOption[]> {
  const agents = (await deps.cloudAgents())
    .filter((agent) => agent.repos.some((repo) => remotes.some((remote) => sameRepo(repo, remote))))
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  const selected = agents.slice(0, MAX_CLOUD_AGENTS);
  if (agents.length > selected.length) warnings.push(translate(locale, "runs.latestCloudAgents"));
  const runs: CursorRunOption[] = [];
  await mapPool(selected, 4, async (agent) => {
    try {
      const listed = await deps.cloudRuns(agent.agentId);
      if (listed.length === 0) {
        runs.push(...agentRuns(agent, [], "cloud", repoPlace(agent)));
        return;
      }
      for (const run of listed) {
        const stamped = { ...agent, lastModified: run.createdAt ?? agent.lastModified };
        const fromRun = agentRuns(stamped, run.messages, "cloud", repoPlace(agent));
        runs.push(...fromRun.map((item, index) => ({ ...item, id: `${run.id}:${index}` })));
      }
    } catch (err) {
      warnings.push(translate(locale, "runs.cloudAgentError", { agent: agent.name || agent.agentId, message: messageOf(err, locale) }));
    }
  });
  return runs;
}

function repoPlace(agent: ListedAgent): string {
  const repo = agent.repos[0] ?? "";
  const parts = repo.replace(/\.git$/, "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || agent.name || "Cloud";
}

async function readCapped(file: string, size: number): Promise<string> {
  const length = Math.min(size, MAX_FILE_BYTES);
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function defaultDeps(): RepoRunDeps {
  return {
    projectsRoot: path.join(os.homedir(), ".cursor", "projects"),
    checkouts: gitCheckouts,
    localAgents: (cwd) => listAgents({ runtime: "local", cwd }),
    localMessages: async (agentId, cwd) => {
      const messages = await Agent.messages.list(agentId, { runtime: "local", cwd, limit: 200 });
      return messages.flatMap((message) => {
        const text = messageText(message.message);
        return text ? [{ role: message.type, text }] : [];
      });
    },
    cloudAgents: () => listAgents({ runtime: "cloud", includeArchived: true }),
    cloudRuns: async (agentId) => {
      const listed = await paginate((cursor) => Agent.listRuns(agentId, { runtime: "cloud", limit: 10, cursor }), 1);
      return mapPool(listed.slice(0, 8), 4, async (run) => {
        let messages: ChatTurn[] = [];
        if (run.supports("conversation")) {
          try {
            messages = conversationTurns(await run.conversation());
          } catch {
            messages = [];
          }
        }
        return { id: run.id, createdAt: epochMs(run.createdAt), messages };
      });
    },
  };
}

async function listAgents(options: Parameters<typeof Agent.list>[0]): Promise<ListedAgent[]> {
  const listed = await paginate((cursor) => Agent.list({ ...options, limit: 50, cursor }), MAX_CLOUD_PAGES);
  return listed.map(toListedAgent);
}

function toListedAgent(agent: SDKAgentInfo): ListedAgent {
  return {
    agentId: agent.agentId,
    name: agent.name ?? "",
    summary: agent.summary ?? "",
    repos: agent.runtime === "cloud" ? agent.repos ?? [] : [],
    lastModified: epochMs(agent.lastModified ?? agent.createdAt),
  };
}

function epochMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function conversationTurns(turns: ConversationTurn[]): ChatTurn[] {
  const messages: ChatTurn[] = [];
  for (const turn of turns) {
    if (turn.type !== "agentConversationTurn") continue;
    const user = turn.turn.userMessage?.text?.trim();
    if (user) messages.push({ role: "user", text: user });
    for (const step of turn.turn.steps) {
      if (step.type === "assistantMessage" && step.message.text.trim()) {
        messages.push({ role: "assistant", text: step.message.text });
      }
    }
  }
  return messages;
}

async function gitCheckouts(workspacePath: string): Promise<{ paths: string[]; remotes: string[] }> {
  try {
    const [worktrees, remotes] = await Promise.all([
      runGit(["worktree", "list", "--porcelain"], workspacePath),
      runGit(["remote", "-v"], workspacePath),
    ]);
    const paths = parseWorktrees(worktrees);
    return { paths: paths.length > 0 ? paths : [workspacePath], remotes: parseRemotes(remotes) };
  } catch {
    return { paths: [workspacePath], remotes: [] };
  }
}

async function paginate<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
  maxPages: number,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor || result.items.length === 0) break;
    cursor = result.nextCursor;
  }
  return items;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await fn(item);
    }
  }
  if (items.length > 0) {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  }
  return results;
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(stderr.trim() ? new Error(stderr.trim()) : new LocalizedError("runner.gitFailed", { command: args[0], code: code ?? "—" }));
    });
  });
}

function messageOf(err: unknown, locale: Locale): string {
  return localizedMessage(err, (key, values) => translate(locale, key, values));
}
