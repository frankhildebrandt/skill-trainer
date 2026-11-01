import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isLocale, resolveLocale, translate, type Locale, type Translate } from "@shared/i18n";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() => resolveLocale(navigator.languages));
  const revision = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const api = window.trainer;
    if (!api) return;
    let cancelled = false;
    const initialRevision = revision.current;
    const unsubscribe = api.onLocaleChange((next) => {
      if (isLocale(next)) {
        revision.current += 1;
        updateLocale(next);
      }
    });
    void api.loadLocale().then((saved) => {
      if (!cancelled && revision.current === initialRevision && isLocale(saved)) updateLocale(saved);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (next) => {
      if (!isLocale(next)) return;
      revision.current += 1;
      updateLocale(next);
      const api = window.trainer;
      if (api) {
        // Keep rapid changes in order, including writes to the shared preferences file.
        saveQueue.current = saveQueue.current.catch(() => undefined).then(() => api.saveLocale(next));
        void saveQueue.current.catch(() => undefined);
      }
    },
    t: (key, values) => translate(locale, key, values),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is missing.");
  return value;
}
