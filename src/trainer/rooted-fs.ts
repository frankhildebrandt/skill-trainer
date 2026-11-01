import { FileNotFoundError, InvalidGrepPatternError, type FileSystem } from "@cursor/sdk";
import fs from "node:fs/promises";
import path from "node:path";

type DirEntry = { path: string; size?: number; kind?: "file" | "directory" };
type FileInfo = { kind: "file" } | { kind: "directory" } | { kind: "missing" };

/** File tools see only this directory. Paths stay inside it, and shell is not available. */
export function rootedFs(rootDir: string): FileSystem {
  const root = path.resolve(rootDir);

  function locate(input: string | undefined): { posix: string; host: string } | null {
    const raw = (input ?? "/").replace(/\\/g, "/");
    const parts = raw.split("/").filter((part) => part.length > 0);
    if (parts.some((part) => part === "..")) return null;
    const host = path.resolve(root, ...parts);
    if (host !== root && !host.startsWith(`${root}${path.sep}`)) return null;
    const posix = parts.length === 0 ? "/" : `/${parts.join("/")}`;
    return { posix, host };
  }

  async function filesUnder(hostDir: string, posixDir: string): Promise<DirEntry[]> {
    const found: DirEntry[] = [];
    async function walk(dir: string, posix: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const host = path.join(dir, entry.name);
        const next = posix === "/" ? `/${entry.name}` : `${posix}/${entry.name}`;
        if (entry.isDirectory()) await walk(host, next);
        else if (entry.isFile()) {
          const stat = await fs.stat(host).catch(() => null);
          found.push({ path: next, size: stat?.size });
        }
      }
    }
    const stat = await fs.stat(hostDir).catch(() => null);
    if (!stat) return [];
    if (stat.isFile()) return [];
    await walk(hostDir, posixDir);
    found.sort((left, right) => left.path.localeCompare(right.path));
    return found;
  }

  return {
    async *list(prefix?: string, options?: { excludes?: readonly string[]; limit?: number; maxDepth?: number }) {
      const located = locate(prefix);
      if (!located) return;
      const rows = collapse(await filesUnder(located.host, located.posix), located.posix, options?.maxDepth).filter(
        (row) => !excluded(row.path, options?.excludes),
      );
      const cap = options?.limit ?? Number.POSITIVE_INFINITY;
      for (const row of rows.slice(0, cap)) yield row;
    },
    async stat(posixPath: string): Promise<FileInfo> {
      const located = locate(posixPath);
      if (!located) return { kind: "missing" };
      const stat = await fs.stat(located.host).catch(() => null);
      if (!stat) return { kind: "missing" };
      if (stat.isFile()) return { kind: "file" };
      if (stat.isDirectory()) return { kind: "directory" };
      return { kind: "missing" };
    },
    async *glob(pattern: string, dir?: string, options?: { limit?: number }) {
      const located = locate(dir);
      if (!located) return;
      const rows = (await filesUnder(located.host, located.posix)).filter((row) =>
        matchGlob(relative(located.posix, row.path), pattern),
      );
      const cap = options?.limit ?? Number.POSITIVE_INFINITY;
      for (const row of rows.slice(0, cap)) yield row;
    },
    async read(posixPath: string): Promise<string | Uint8Array> {
      const located = locate(posixPath);
      const stat = located ? await fs.stat(located.host).catch(() => null) : null;
      if (!located || !stat?.isFile()) throw new FileNotFoundError(located?.posix ?? posixPath);
      const bytes = await fs.readFile(located.host);
      return bytes.includes(0) ? bytes : bytes.toString("utf8");
    },
    async *grep(query: { pattern: string; path?: string; glob?: string; maxResults?: number }) {
      let expression: RegExp;
      try {
        expression = new RegExp(query.pattern, "g");
      } catch {
        throw new InvalidGrepPatternError(query.pattern, query.path ?? "/");
      }
      const located = locate(query.path);
      if (!located) return;
      const stat = await fs.stat(located.host).catch(() => null);
      if (!stat) return;
      const files = stat.isFile()
        ? [{ path: located.posix, size: stat.size }]
        : await filesUnder(located.host, located.posix);
      let hits = 0;
      const cap = query.maxResults ?? Number.POSITIVE_INFINITY;
      for (const file of files) {
        if (query.glob && !grepGlob(file.path, located.posix, query.glob)) continue;
        const where = locate(file.path);
        if (!where) continue;
        const bytes = await fs.readFile(where.host).catch(() => null);
        if (!bytes || bytes.includes(0)) continue;
        const lines = bytes.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          expression.lastIndex = 0;
          if (!expression.test(lines[index] ?? "")) continue;
          yield { path: file.path, lineNumber: index + 1, line: lines[index] ?? "" };
          hits += 1;
          if (hits >= cap) return;
        }
      }
    },
    async write(posixPath: string, contents: string | Uint8Array): Promise<void> {
      const located = locate(posixPath);
      if (!located || located.posix === "/") throw new FileNotFoundError(posixPath);
      await fs.mkdir(path.dirname(located.host), { recursive: true });
      await fs.writeFile(located.host, contents);
    },
    async delete(posixPath: string): Promise<void> {
      const located = locate(posixPath);
      const stat = located ? await fs.stat(located.host).catch(() => null) : null;
      if (!located || !stat?.isFile()) throw new FileNotFoundError(located?.posix ?? posixPath);
      await fs.unlink(located.host);
    },
  };
}

function collapse(
  files: DirEntry[],
  scope: string,
  maxDepth: number | undefined,
): DirEntry[] {
  if (maxDepth == null || maxDepth < 1) return files;
  const seen = new Set<string>();
  const rows: DirEntry[] = [];
  for (const file of files) {
    const rest = scope === "/" ? file.path.slice(1) : file.path.slice(scope.length + 1);
    const parts = rest.split("/").filter((part) => part.length > 0);
    if (parts.length <= maxDepth) {
      rows.push(file);
      continue;
    }
    const ancestor = `${scope === "/" ? "" : scope}/${parts.slice(0, maxDepth).join("/")}`;
    if (seen.has(ancestor)) continue;
    seen.add(ancestor);
    rows.push({ path: ancestor, kind: "directory" });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function relative(dir: string, file: string): string {
  if (dir === "/") return file.replace(/^\//, "");
  return file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : file;
}

function matchGlob(file: string, pattern: string): boolean {
  const source = pattern
    .split(/(\*\*|\*|\?)/)
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      if (part === "?") return "[^/]";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`).test(file);
}

function grepGlob(file: string, scope: string, pattern: string): boolean {
  if (pattern.includes("/")) return matchGlob(relative(scope, file), pattern);
  return matchGlob(path.posix.basename(file), pattern);
}

function excluded(file: string, excludes: readonly string[] | undefined): boolean {
  if (!excludes || excludes.length === 0) return false;
  const parts = file.split("/");
  return excludes.some((pattern) => parts.some((part) => part.length > 0 && matchGlob(part, pattern)));
}
