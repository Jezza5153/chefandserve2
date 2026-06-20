"use client";

/**
 * CHEF-PR11 — client locale context. The server layout resolves the locale (from
 * the cookie + flag) and passes it in; client components read the dictionary via
 * useT(). Keeping the dict derivation on the client (from the locale) means we
 * pass one short string across the RSC boundary, not the whole dictionary.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { getDict, type Dict } from "@/lib/i18n/get-dict";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";

type LocaleContextValue = { locale: Locale; t: Dict };

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: getDict(DEFAULT_LOCALE),
});

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleContextValue>(() => ({ locale, t: getDict(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The active dictionary, e.g. `const t = useT(); t.nav.today`. */
export function useT(): Dict {
  return useContext(LocaleContext).t;
}

/** The active locale string, for the toggle's "which one is on" state. */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}
