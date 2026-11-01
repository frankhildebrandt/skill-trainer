import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { restoreSettings, settingsHaveWork } from "../shared/settings";
import type { TrainRequest } from "../shared/types";

export async function readSavedSettings(): Promise<TrainRequest | null> {
  const file = settingsFile();
  try {
    return restoreSettings(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  return readNewestSession();
}

export async function writeSavedSettings(request: TrainRequest): Promise<void> {
  const restored = restoreSettings(request);
  if (!restored) return;
  const file = settingsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(restored, null, 2)}\n`);
}

async function readNewestSession(): Promise<TrainRequest | null> {
  const sessions = path.join(app.getPath("userData"), "sessions");
  let names: string[] = [];
  try {
    names = (await fs.readdir(sessions)).sort();
  } catch {
    return null;
  }
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const name = names[index];
    if (!name) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(sessions, name, "request.json"), "utf8"));
      const restored = restoreSettings(raw);
      if (restored && settingsHaveWork(restored)) return restored;
    } catch {
      continue;
    }
  }
  return null;
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}
