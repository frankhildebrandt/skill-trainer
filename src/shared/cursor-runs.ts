export type CursorRuntime = "local" | "cloud";

export interface CursorRunOption {
  id: string;
  runtime: CursorRuntime;
  title: string;
  /** User text that becomes the training assignment. */
  prompt: string;
  /** Title, assignment, and reply text used by full-text search. */
  searchText: string;
  createdAt: number | null;
  /** Checkout folder or repository label. */
  place: string;
}

export interface CursorRunCatalog {
  workspacePath: string;
  runs: CursorRunOption[];
  warnings: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const MAX_PROMPT = 20_000;
const MAX_SEARCH = 80_000;

/** Cursor names `~/.cursor/projects` folders by collapsing every non-alphanumeric run. */
export function cursorProjectSlug(filePath: string): string {
  return filePath.replace(/[\\/]+$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizeRepoUrl(input: string): string {
  let url = input.trim().toLowerCase();
  if (!url) return "";
  url = url.replace(/\.git$/, "");
  url = url.replace(/^git@([^:]+):/, "$1/");
  url = url.replace(/^ssh:\/\/(?:git@)?([^/]+)\//, "$1/");
  url = url.replace(/^https?:\/\/(?:[^@/]+@)?/, "");
  return url.replace(/\/+$/, "");
}

export function sameRepo(left: string, right: string): boolean {
  const a = normalizeRepoUrl(left);
  const b = normalizeRepoUrl(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function parseRemotes(text: string): string[] {
  const urls = new Set<string>();
  for (const line of text.split("\n")) {
    const url = line.trim().split(/\s+/)[1];
    if (url) urls.add(url);
  }
  return [...urls];
}

export function parseWorktrees(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

/** Pulls the typed request out of a Cursor transcript user message. */
export function assignmentText(raw: string): string {
  const tagged = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/gi)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (tagged) return clip(tagged, MAX_PROMPT);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("<")) return "";
  return clip(trimmed, MAX_PROMPT);
}

export function messageText(message: unknown, depth = 0): string {
  if (typeof message === "string") return message.trim();
  if (!message || typeof message !== "object") return "";
  const record = message as { text?: unknown; content?: unknown; message?: unknown };
  const parts: string[] = [];
  if (typeof record.text === "string") parts.push(record.text);
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (typeof block === "string") parts.push(block);
      else if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        parts.push((block as { text: string }).text);
      }
    }
  }
  const joined = parts.join("\n").trim();
  if (joined || depth >= 2 || record.message == null) return joined;
  return messageText(record.message, depth + 1);
}

export function runsFromMessages(input: {
  idPrefix: string;
  runtime: CursorRuntime;
  messages: Array<{ role: string; text: string }>;
  place: string;
  createdAt: number | null;
}): CursorRunOption[] {
  const runs: CursorRunOption[] = [];
  let current: { raw: string; extra: string[] } | null = null;
  let index = 0;

  const flush = () => {
    if (!current) return;
    const prompt = assignmentText(current.raw);
    const raw = current.raw;
    const extra = current.extra;
    current = null;
    if (!prompt) return;
    const searchable = [prompt, raw, ...extra].map((part) => part.replace(/<[^>]+>/g, " ")).join("\n");
    const createdAt = input.createdAt == null ? null : input.createdAt + index;
    runs.push({
      id: `${input.idPrefix}:${index}`,
      runtime: input.runtime,
      title: runTitle(prompt),
      prompt,
      searchText: clip(`${searchable}`, MAX_SEARCH),
      createdAt,
      place: input.place,
    });
    index += 1;
  };

  for (const message of input.messages) {
    if (message.role === "user") {
      flush();
      current = { raw: message.text, extra: [] };
    } else if (message.role === "assistant" && current) {
      current.extra.push(message.text);
    }
  }
  flush();
  return runs;
}

export function withSearchPrefix(runs: CursorRunOption[], prefix: string): CursorRunOption[] {
  const label = prefix.trim();
  if (!label) return runs;
  return runs.map((run) => ({ ...run, searchText: clip(`${label}\n${run.searchText}`, MAX_SEARCH) }));
}

export function dedupeRuns(runs: CursorRunOption[]): CursorRunOption[] {
  const sorted = [...runs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const seen = new Set<string>();
  const unique: CursorRunOption[] = [];
  for (const run of sorted) {
    const key = `${run.runtime}\n${run.prompt.replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(run);
  }
  return unique;
}

export function searchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function filterCursorRuns(
  runs: CursorRunOption[],
  query: string,
  runtime: "all" | CursorRuntime,
): CursorRunOption[] {
  const terms = searchTerms(query);
  return runs.filter((run) => {
    if (runtime !== "all" && run.runtime !== runtime) return false;
    if (terms.length === 0) return true;
    const haystack = `${run.title}\n${run.prompt}\n${run.searchText}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function matchSnippet(run: CursorRunOption, query: string): string {
  const terms = searchTerms(query);
  const source = run.searchText.replace(/\s+/g, " ").trim();
  if (terms.length === 0) return excerpt(run.prompt);
  const lower = source.toLocaleLowerCase();
  const term = terms.find((item) => lower.includes(item));
  if (!term) return excerpt(run.prompt);
  const at = lower.indexOf(term);
  const start = Math.max(0, at - 70);
  const end = Math.min(source.length, at + term.length + 140);
  const slice = source.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < source.length ? "…" : ""}`;
}

export function runTitle(prompt: string): string {
  const line = prompt.split("\n").map((part) => part.trim()).find(Boolean) ?? "Ohne Text";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

export function excerpt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length > 220 ? `${flat.slice(0, 219)}…` : flat;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}
