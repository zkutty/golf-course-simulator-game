import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadLocale, LOCALE_STORAGE_KEY, setActiveLocale, translate, type Locale } from "./core";
import { I18nContext, type I18nValue } from "./context";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => loadLocale());
  setActiveLocale(locale);
  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    setLocaleState(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "pseudo" ? "en-XA" : "en";
    document.documentElement.dataset.locale = locale;
  }, [locale]);
  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
