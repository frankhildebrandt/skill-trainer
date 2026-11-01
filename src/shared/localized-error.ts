import { translate, type Translate, type TranslationKey, type TranslationValues } from "./i18n";

/** Keep diagnostic details intact until the UI boundary chooses a language. */
export class LocalizedError extends Error {
  constructor(readonly key: TranslationKey, readonly values: TranslationValues = {}) {
    super(translate("de", key, values));
    this.name = "LocalizedError";
  }
}

export function localizedMessage(error: unknown, t: Translate): string {
  if (error instanceof LocalizedError) return t(error.key, error.values);
  return error instanceof Error ? error.message : String(error);
}
