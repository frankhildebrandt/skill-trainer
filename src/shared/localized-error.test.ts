import { describe, expect, it } from "vitest";
import { translate, SUPPORTED_LOCALES, type Translate } from "./i18n";
import { LocalizedError, localizedMessage } from "./localized-error";

describe("localized diagnostics", () => {
  it("keeps keys and literal values until the UI selects the language", () => {
    const error = new LocalizedError("runner.gitFailed", { command: "$& {path}", code: 128 });
    expect(error.message).toBe("git $& {path} ist fehlgeschlagen (128)");
    expect(localizedMessage(error, (key, values) => translate("fr", key, values)))
      .toBe("git $& {path} a échoué (128)");
  });

  it("localizes app errors in all supported languages while preserving external diagnostics", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t: Translate = (key, values) => translate(locale, key, values);
      expect(localizedMessage(new LocalizedError("runner.failed"), t)).toBe(t("runner.failed"));
      expect(localizedMessage(new Error("SDK: model not found (request 42)"), t)).toBe("SDK: model not found (request 42)");
      expect(localizedMessage("raw diagnostic", t)).toBe("raw diagnostic");
    }
  });
});
