export const SUPPORTED_LOCALES = ["de", "en", "fr", "it", "es", "nl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type Translations<T extends Record<string, string>> = Record<Locale, { [K in keyof T]: string }>;
