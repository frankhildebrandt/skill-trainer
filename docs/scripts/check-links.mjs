import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : extname(path) === ".html" ? [path] : [];
  }));
  return files.flat();
}

const pages = await htmlFiles(dist);
const content = new Map(await Promise.all(pages.map(async (page) => [page, await readFile(page, "utf8")])));
const errors = [];
let checked = 0;

for (const [page, html] of content) {
  const source = relative(dist, page);
  const base = `https://docs.local/${source.replace(/index\.html$/, "")}`;
  for (const match of html.matchAll(/\b(?:href|src)="([^"<>]+)"/g)) {
    const target = match[1].replaceAll("&amp;", "&");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    const url = new URL(target, base);
    const pathname = decodeURIComponent(url.pathname);
    let file = resolve(dist, `.${pathname}`);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      await stat(file);
      if (url.hash && extname(file) === ".html") {
        const destination = content.get(file) ?? await readFile(file, "utf8");
        const anchor = decodeURIComponent(url.hash.slice(1));
        const ids = new Set([...destination.matchAll(/\bid="([^"<>]+)"/g)].map((id) => id[1]));
        if (!ids.has(anchor)) errors.push(`${source}: missing anchor ${target}`);
      }
    } catch {
      errors.push(`${source}: missing file ${target}`);
    }
    checked++;
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} internal links and assets across ${pages.length} HTML pages.`);
}
