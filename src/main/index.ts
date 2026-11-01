import { app, BrowserWindow, nativeImage, shell, type NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { attachWindow, registerBackend } from "./backend";

function loadIcon(): NativeImage | undefined {
  const file = path.join(app.getAppPath(), "resources", "icon.png");
  if (!fs.existsSync(file)) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 980,
    minHeight: 700,
    title: "Skill Trainer",
    backgroundColor: "#030509",
    icon: loadIcon(),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 18, y: 19 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  attachWindow(win);
  return win;
}

app.whenReady().then(() => {
  const icon = loadIcon();
  if (icon) app.dock?.setIcon(icon);
  registerBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
