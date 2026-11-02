import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../astro.config.mjs";
import { withBasePath } from "../src/lib/base-path.mjs";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const site = new URL(config.site ?? "https://docs.local");
const basePath = `/${(config.base ?? "/").split("/").filter(Boolean).join("/")}`;

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

async function checkTarget(target, source) {
  const pagePath = withBasePath(`/${source.replace(/index\.html$/, "")}`, basePath);
  const url = new URL(target, new URL(pagePath, site));
  if (url.origin !== site.origin) return;
  const pathname = decodeURIComponent(url.pathname);
  if (basePath !== "/" && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    errors.push(`${source}: URL outside configured base ${target}`);
    return;
  }
  const localPath = basePath === "/" ? pathname : pathname.slice(basePath.length) || "/";
  let file = resolve(dist, `.${localPath}`);
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

for (const [page, html] of content) {
  const source = relative(dist, page);
  for (const match of html.matchAll(/\b(?:href|src)="([^"<>]+)"/g)) {
    await checkTarget(match[1].replaceAll("&amp;", "&"), source);
  }
}

const searchIndex = JSON.parse(await readFile(join(dist, "search-index.json"), "utf8"));
for (const document of searchIndex) {
  await checkTarget(document.href, "search-index.json");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} internal links and assets across ${pages.length} HTML pages.`);
}
