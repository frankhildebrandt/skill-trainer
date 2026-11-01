import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  markdown: {
    shikiConfig: { theme: "github-dark" },
  },
});
