import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import baseUrls from "./src/lib/base-urls.mjs";

const base = "/skill-trainer";

export default defineConfig({
  site: "https://frankhildebrandt.github.io",
  base,
  output: "static",
  trailingSlash: "always",
  markdown: {
    processor: satteri({ hastPlugins: [baseUrls(base)] }),
    shikiConfig: { theme: "github-dark" },
  },
});
