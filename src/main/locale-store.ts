import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { isLocale, resolveLocale, type Locale } from "../shared/i18n";

export async function readSavedLocale(): Promise<Locale> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(preferencesFile(), "utf8"));
    if (raw && typeof raw === "object" && "locale" in raw && isLocale(raw.locale)) return raw.locale;
  } catch {
    // Missing or unreadable preferences use the operating system's preferred languages.
  }
  return resolveLocale(app.getPreferredSystemLanguages());
}

export async function writeSavedLocale(locale: Locale): Promise<void> {
  const file = preferencesFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ locale }, null, 2)}\n`);
}

function preferencesFile(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}
