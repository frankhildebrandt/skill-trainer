import { appMessages } from "./i18n/app";
import { backendMessages } from "./i18n/backend";
import { formMessages } from "./i18n/form";
import { runsMessages } from "./i18n/runs";
import { skillFileMessages } from "./i18n/skill-files";
import { diagnosticMessages } from "./i18n/diagnostics";
import { runnerMessages } from "./i18n/runner";
import { SUPPORTED_LOCALES, type Locale } from "./i18n/types";

export { SUPPORTED_LOCALES, type Locale } from "./i18n/types";

export const LANGUAGE_NAMES: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  nl: "Nederlands",
};

export const messages = {
  de: { ...appMessages.de, ...formMessages.de, ...runsMessages.de, ...backendMessages.de, ...skillFileMessages.de, ...diagnosticMessages.de, ...runnerMessages.de },
  en: { ...appMessages.en, ...formMessages.en, ...runsMessages.en, ...backendMessages.en, ...skillFileMessages.en, ...diagnosticMessages.en, ...runnerMessages.en },
  fr: { ...appMessages.fr, ...formMessages.fr, ...runsMessages.fr, ...backendMessages.fr, ...skillFileMessages.fr, ...diagnosticMessages.fr, ...runnerMessages.fr },
  it: { ...appMessages.it, ...formMessages.it, ...runsMessages.it, ...backendMessages.it, ...skillFileMessages.it, ...diagnosticMessages.it, ...runnerMessages.it },
  es: { ...appMessages.es, ...formMessages.es, ...runsMessages.es, ...backendMessages.es, ...skillFileMessages.es, ...diagnosticMessages.es, ...runnerMessages.es },
  nl: { ...appMessages.nl, ...formMessages.nl, ...runsMessages.nl, ...backendMessages.nl, ...skillFileMessages.nl, ...diagnosticMessages.nl, ...runnerMessages.nl },
};

export type TranslationKey = keyof typeof messages.de;
export type TranslationValues = Record<string, string | number>;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

/** Match regional system languages (for example fr-CH) in preference order. */
export function resolveLocale(preferred: readonly string[], fallback: Locale = "en"): Locale {
  for (const language of preferred) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return fallback;
}

export function translate(locale: Locale, key: TranslationKey, values: TranslationValues = {}): string {
  const message = messages[locale]?.[key] ?? messages.en[key] ?? messages.de[key];
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
