export type ActivityUpdate =
  | { op: "append"; kind: "thinking" | "text"; text: string }
  | {
      op: "tool";
      callId: string;
      name: string;
      status: "running" | "completed" | "error";
      detail: string;
      output: string;
    }
  | { op: "note"; text: string };

export type RunBlock =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      status: "running" | "completed" | "error";
      detail: string;
      output: string;
    }
  | { kind: "note"; text: string };

export function applyRunUpdate(blocks: RunBlock[], update: ActivityUpdate): RunBlock[] {
  if (update.op === "note") return [...blocks, { kind: "note", text: update.text }];
  if (update.op === "append") {
    const last = blocks.at(-1);
    if (last && last.kind === update.kind) {
      return [...blocks.slice(0, -1), { kind: update.kind, text: last.text + update.text }];
    }
    return [...blocks, { kind: update.kind, text: update.text }];
  }
  const tool: RunBlock = {
    kind: "tool",
    callId: update.callId,
    name: update.name,
    status: update.status,
    detail: update.detail,
    output: update.output,
  };
  const index = blocks.findIndex((block) => block.kind === "tool" && block.callId === update.callId);
  if (index < 0) return [...blocks, tool];
  const previous = blocks[index];
  if (!previous || previous.kind !== "tool") return [...blocks, tool];
  const next = blocks.slice();
  next[index] = {
    ...tool,
    detail: update.detail || previous.detail,
    output: update.output || previous.output,
  };
  return next;
}

export function toolDetail(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  return (
    pick(record, ["command", "cmd"]) ??
    pick(record, [
      "path",
      "file_path",
      "target_file",
      "globPattern",
      "glob_pattern",
      "pattern",
      "query",
      "targetDirectory",
    ]) ??
    ""
  );
}

export function toolOutput(result: unknown): string {
  const value = unwrap(result);
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (typeof record.diffString === "string") return record.diffString;
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  if (stdout || stderr) return [stdout, stderr].filter((part) => part.length > 0).join("\n");
  if (Array.isArray(record.files)) return record.files.map(fileLine).filter((line) => line.length > 0).join("\n");
  return JSON.stringify(value, null, 2);
}

function unwrap(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  return "value" in record ? record.value : result;
}

function fileLine(file: unknown): string {
  if (typeof file === "string") return file;
  if (file && typeof file === "object" && "path" in file && typeof (file as { path: unknown }).path === "string") {
    return (file as { path: string }).path;
  }
  return JSON.stringify(file);
}

function pick(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
