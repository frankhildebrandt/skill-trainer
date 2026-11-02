import fs from "node:fs/promises";
import path from "node:path";
import type { ExecuteRequest } from "./attempt";

type FileSystem = NonNullable<ExecuteRequest["fs"]>;
type ToolResult = { contentItems: Array<{ type: "inputText"; text: string }>; success: boolean };

/** Exposes only host-validated file operations; no command or native environment is needed. */
export function codexFileTools(fileSystem: FileSystem, readOnly: boolean, rootDir: string) {
  let read = false;
  const operations: Record<string, { description: string; properties: Record<string, unknown>; required: string[]; run: (args: Record<string, unknown>) => Promise<unknown> }> = {
    read_file: {
      description: "Read a UTF-8 file inside the supplied repository. Paths are relative to its root.",
      properties: { path: { type: "string" } }, required: ["path"],
      async run(args) {
        const content = await fileSystem.read(string(args, "path"));
        if (typeof content !== "string") throw new Error("This file contains binary data.");
        read = true;
        return content;
      },
    },
    list_files: {
      description: "List files inside the supplied repository, optionally below a relative path.",
      properties: { path: { type: "string" } }, required: [],
      async run(args) {
        const rows: unknown[] = [];
        for await (const row of fileSystem.list(optionalString(args, "path"), { excludes: [".git", "node_modules", ".venv", "venv"], limit: 300 })) rows.push(row);
        return rows;
      },
    },
    search_files: {
      description: "Search repository text files with a regular expression, optionally below a relative path.",
      properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"],
      async run(args) {
        const rows: unknown[] = [];
        for await (const row of fileSystem.grep({ pattern: string(args, "pattern"), path: optionalString(args, "path"), maxResults: 100 })) rows.push(row);
        if (rows.length > 0) read = true;
        return rows;
      },
    },
  };
  if (!readOnly) {
    operations.write_file = {
      description: "Write or replace a UTF-8 file inside the supplied repository, creating parent directories.",
      properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"],
      async run(args) { await fileSystem.write(string(args, "path"), string(args, "content")); return "File written."; },
    };
    operations.delete_file = {
      description: "Delete one file inside the supplied repository.",
      properties: { path: { type: "string" } }, required: ["path"],
      async run(args) { await fileSystem.delete(string(args, "path")); return "File deleted."; },
    };
  }
  return {
    get sawRead() { return read; },
    specs: Object.entries(operations).map(([name, tool]) => ({
      type: "function", name: `skill_trainer_${name}`, description: tool.description,
      inputSchema: { type: "object", properties: tool.properties, required: tool.required, additionalProperties: false },
    })),
    async call(name: string, args: unknown): Promise<ToolResult> {
      try {
        const operation = operations[name.replace(/^skill_trainer_/, "")];
        if (!name.startsWith("skill_trainer_") || !operation) throw new Error(`Unsupported file tool: ${name}`);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("File tool arguments must be an object.");
        const input = args as Record<string, unknown>;
        await assertSafePath(rootDir, optionalString(input, "path") ?? "/");
        const output = await operation.run(input);
        return { contentItems: [{ type: "inputText", text: typeof output === "string" ? output : JSON.stringify(output) }], success: true };
      } catch (error) {
        return { contentItems: [{ type: "inputText", text: error instanceof Error ? error.message : String(error) }], success: false };
      }
    },
  };
}

function string(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] === undefined ? undefined : string(args, key);
}

/** Rejects direct and ancestor symlinks before a virtual path reaches the host filesystem. */
async function assertSafePath(rootDir: string, input: string): Promise<void> {
  const parts = input.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.includes("..")) throw new Error("Paths must stay inside the supplied repository.");
  let current = await fs.realpath(rootDir);
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Symbolic links are unavailable to repository file tools.");
  }
}
