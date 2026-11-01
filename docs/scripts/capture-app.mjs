import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const destination = resolve(directory, "../public/screenshots");
const appRequire = createRequire(join(root, "package.json"));

/** Resolves the app toolchain independently of Astro's own Vite dependency. */
function importFromApp(name) {
  return import(pathToFileURL(appRequire.resolve(name)).href);
}

/** Builds the original renderer with documentation-only fixture data, then captures it in Electron. */
async function prepare() {
  const temporary = await mkdtemp(join(tmpdir(), "skill-trainer-screenshots-"));
  try {
    const [{ build }, { default: react }, { default: electron }] = await Promise.all([
      importFromApp("vite"), importFromApp("@vitejs/plugin-react"), importFromApp("electron"),
    ]);
    await build({
      configFile: false,
      root: resolve(root, "src/renderer"),
      base: "./",
      resolve: { alias: { "@shared": resolve(root, "src/shared") } },
      plugins: [
        {
          name: "documentation-fixture",
          enforce: "pre",
          transform(source, id) {
            if (id === resolve(root, "src/renderer/src/main.tsx")) {
              return `import ${JSON.stringify(resolve(directory, "screenshot-fixture.ts"))};\n${source}`;
            }
          },
        },
        react(),
      ],
      build: { outDir: join(temporary, "renderer"), emptyOutDir: true },
    });
    await new Promise((done, reject) => {
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(electron, [fileURLToPath(import.meta.url), "--capture", temporary], {
        cwd: root, stdio: "inherit", env: environment,
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`Electron capture failed: ${signal ?? `exit ${code}`}`)));
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Uses application DOM controls without changing app code or connecting to the training backend. */
async function capture(temporary) {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(temporary, "electron-profile"));
  await app.whenReady();
  await mkdir(destination, { recursive: true });
  const window = new BrowserWindow({
    width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true },
  });
  const execute = (script) => window.webContents.executeJavaScript(script);
  const settle = () => execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const save = async (name) => {
    const screenshot = await window.webContents.capturePage();
    await writeFile(join(destination, name), screenshot.resize({ width: 1600, height: 1000, quality: "best" }).toPNG());
  };
  try {
    for (const example of ["training", "create"]) {
      await window.loadFile(join(temporary, "renderer/index.html"), { query: { example } });
      await window.webContents.insertCSS("*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } .brand-curve { stroke-dashoffset: 0 !important; }");
      await execute(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const ready = () => document.querySelector('.panel button[type="submit"]')
          ? resolve() : Date.now() > deadline ? reject(new Error('App did not initialize')) : setTimeout(ready, 20);
        ready();
      })`);
      await execute("document.querySelector('.panel button[type=submit]').click()");
      await execute(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const ready = () => document.querySelector('.report')
          ? resolve() : Date.now() > deadline ? reject(new Error('Example session did not complete')) : setTimeout(ready, 20);
        ready();
      })`);
      await execute(`Array.from(document.querySelectorAll('.agent-link')).find(button => button.textContent.includes(${JSON.stringify(example === "training" ? "Optimierer · Schritt 1" : "Create Skill")}))?.click()`);
      await settle();
      await execute("document.querySelector('.feed .sheet').scrollTop = 0; document.querySelector('.logs .sheet').scrollTop = 0;");
      await settle();
      await save(example === "training" ? "training.png" : "create-skill.png");
      if (example === "training") {
        await execute("document.querySelector('.settings-details').open = true");
        await settle();
        await execute("document.querySelector('.panel-scroll').scrollTop = document.querySelector('.panel-scroll').scrollHeight");
        await settle();
        await save("settings.png");
      }
    }
    console.log(`App screenshots written to ${destination}`);
  } finally {
    window.destroy();
    app.quit();
  }
}

// Electron must finish evaluating its main module before app.whenReady() can resolve.
const operation = process.argv[2] === "--capture" ? capture(process.argv[3]) : prepare();
operation.catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  if (process.versions.electron) (await import("electron")).app.exit(1);
});
