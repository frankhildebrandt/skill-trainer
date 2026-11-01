import { describe, expect, it } from "vitest";
import { isLocale, LANGUAGE_NAMES, messages, resolveLocale, SUPPORTED_LOCALES, translate, type TranslationKey } from "./i18n";

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
}

describe("language detection", () => {
  it("matches all six languages including regional and case variants", () => {
    expect(SUPPORTED_LOCALES).toEqual(["de", "en", "fr", "it", "es", "nl"]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(resolveLocale([`${locale.toUpperCase()}-CH`])).toBe(locale);
      expect(resolveLocale([`${locale}_BE`])).toBe(locale);
      expect(isLocale(locale)).toBe(true);
      expect(LANGUAGE_NAMES[locale]).toBeTruthy();
    }
  });

  it("uses preference order and falls back when no language is supported", () => {
    expect(resolveLocale(["pt-BR", "fr-CH", "de-CH"])).toBe("fr");
    expect(resolveLocale(["nl-BE", "en-US"])).toBe("nl");
    expect(resolveLocale(["sv-SE"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
    expect(resolveLocale([], "de")).toBe("de");
    for (const value of [null, undefined, 42, {}, "de-CH", "DE", "xx", ""]) expect(isLocale(value)).toBe(false);
  });
});

describe("translation catalogs", () => {
  it("provides every message and the same interpolation parameters in all languages", () => {
    const keys = Object.keys(messages.de).sort() as TranslationKey[];
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) {
        expect(messages[locale][key].trim(), `${locale}: ${key}`).not.toBe("");
        expect(placeholders(messages[locale][key]), `${locale}: ${key}`).toEqual(placeholders(messages.de[key]));
      }
    }
  });

  it("interpolates literal values without interpreting replacement tokens or nested placeholders", () => {
    expect(translate("en", "app.closeLabel", { label: "$& {count} <skill>" })).toBe("Close $& {count} <skill>");
    expect(translate("de", "app.trainingNumber", { n: 0 })).toBe("Training 0");
    expect(translate("es", "app.closeLabel", { label: "" })).toBe("Cerrar ");
    expect(translate("fr", "app.closeLabel")).toBe("Fermer {label}");
    expect(translate("en", "app.closeLabel", Object.create({ label: "inherited" }))).toBe("Close {label}");
  });

  it("renders the same UI key in each selected language", () => {
    expect(SUPPORTED_LOCALES.map((locale) => translate(locale, "app.language")))
      .toEqual(["Sprache", "Language", "Langue", "Lingua", "Idioma", "Taal"]);
  });
});
