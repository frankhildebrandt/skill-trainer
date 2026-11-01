export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string };

export type Block =
  | { type: "h"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "p"; inlines: Inline[] }
  | { type: "code"; text: string }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1]!.length as 1 | 2 | 3, inlines: parseInline(heading[2] ?? "") });
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push(parseInline((lines[index] ?? "").replace(/^[-*]\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: Inline[][] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        items.push(parseInline((lines[index] ?? "").replace(/^\d+\.\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const table = readTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }
    const para: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "") && !readTable(lines, index)) {
      para.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "p", inlines: parseInline(para.join(" ")) });
  }
  return blocks;
}

export function parseInline(input: string): Inline[] {
  const parts: Inline[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (input.startsWith("**", cursor)) {
      const end = input.indexOf("**", cursor + 2);
      if (end > cursor + 2) {
        parts.push({ type: "strong", text: input.slice(cursor + 2, end) });
        cursor = end + 2;
        continue;
      }
    }
    if (input[cursor] === "`") {
      const end = input.indexOf("`", cursor + 1);
      if (end > cursor) {
        parts.push({ type: "code", text: input.slice(cursor + 1, end) });
        cursor = end + 1;
        continue;
      }
    }
    if (input[cursor] === "*" && input[cursor + 1] !== "*") {
      const end = input.indexOf("*", cursor + 1);
      if (end > cursor + 1) {
        parts.push({ type: "em", text: input.slice(cursor + 1, end) });
        cursor = end + 1;
        continue;
      }
    }
    const next = nextMark(input, cursor);
    parts.push({ type: "text", text: input.slice(cursor, next) });
    cursor = next;
  }
  return parts.filter((part) => part.type !== "text" || part.text.length > 0);
}

function readTable(lines: string[], index: number): { block: Extract<Block, { type: "table" }>; next: number } | null {
  const line = lines[index] ?? "";
  if (!line.includes("|")) return null;
  const next = lines[index + 1] ?? "";
  if (isSeparator(rowCells(next)) && rowCells(line).length > 0) {
    const header = rowCells(line);
    const width = header.length;
    let cursor = index + 2;
    const rows: string[][] = [];
    while (cursor < lines.length && (lines[cursor] ?? "").trim() && (lines[cursor] ?? "").includes("|") && !isSeparator(rowCells(lines[cursor] ?? ""))) {
      const cells = rowCells(lines[cursor] ?? "");
      if (cells.length === 0) break;
      rows.push(fit(cells, width));
      cursor += 1;
    }
    if (rows.length === 0) return null;
    return { block: tableBlock(header, rows), next: cursor };
  }
  const flat = flatTable(line);
  if (!flat) return null;
  return { block: tableBlock(flat.header, flat.rows), next: index + 1 };
}

function tableBlock(header: string[], rows: string[][]): Extract<Block, { type: "table" }> {
  return {
    type: "table",
    header: header.map((cell) => parseInline(cell)),
    rows: rows.map((row) => row.map((cell) => parseInline(cell))),
  };
}

function flatTable(line: string): { header: string[]; rows: string[][] } | null {
  if (!splitCells(line).some((cell) => isSep(cell))) return null;
  const parts = splitCells(line);
  const sep = parts.findIndex((cell) => isSep(cell));
  if (sep < 1) return null;
  let sepEnd = sep;
  while (sepEnd < parts.length && isSep(parts[sepEnd] ?? "")) sepEnd += 1;
  const width = sepEnd - sep;
  const header = parts.slice(0, sep).filter((cell) => cell.length > 0);
  if (header.length !== width) return null;
  const rows: string[][] = [];
  let cursor = sepEnd;
  if (parts[cursor] === "") cursor += 1;
  while (cursor < parts.length) {
    const row = parts.slice(cursor, cursor + width);
    if (row.length !== width) break;
    rows.push(row);
    cursor += width;
    if (parts[cursor] === "") cursor += 1;
  }
  if (rows.length === 0) return null;
  return { header, rows };
}

function splitCells(line: string): string[] {
  const parts = line.split("|").map((cell) => cell.trim());
  while (parts[0] === "") parts.shift();
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function rowCells(line: string): string[] {
  return splitCells(line);
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => isSep(cell));
}

function isSep(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

function fit(cells: string[], width: number): string[] {
  const row = cells.slice(0, width);
  while (row.length < width) row.push("");
  return row;
}

function isBlockStart(line: string): boolean {
  return line.startsWith("```") || /^(#{1,3})\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function nextMark(input: string, from: number): number {
  let at = from + 1;
  while (at < input.length) {
    if (input.startsWith("**", at) || input[at] === "`" || (input[at] === "*" && input[at + 1] !== "*")) return at;
    at += 1;
  }
  return input.length;
}
