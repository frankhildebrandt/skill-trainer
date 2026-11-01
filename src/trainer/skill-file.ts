export function frontmatterName(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const line = match[1].match(/^name:\s*(.+)$/m);
  if (!line) return null;
  return line[1].trim().replace(/^["']|["']$/g, "");
}

export function skillSlug(markdown: string): string {
  const name = frontmatterName(markdown) ?? "trained-skill";
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "trained-skill";
}

export function skillPreview(markdown: string): { name: string; chars: number; preview: string } {
  return {
    name: frontmatterName(markdown) ?? "(ohne name)",
    chars: markdown.length,
    preview: markdown.slice(0, 1200),
  };
}
