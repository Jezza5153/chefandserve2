/**
 * CHEF-PR11 — server-only locale resolution. Reads the per-device `cs_locale`
 * cookie, but ONLY honours a non-Dutch choice when I18N_ENABLED is on — so prod
 * stays fully Dutch until the EN copy is complete and the flag is flipped.
 */
import "server-only";

import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { getDict, type Dict } from "@/lib/i18n/get-dict";
import { asLocale, DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";

/** Master switch — when off, the toggle is hidden and everyone gets Dutch. */
export function i18nEnabled(): boolean {
  return env.I18N_ENABLED === "true";
}

/** The active locale for this request (Dutch unless the flag is on AND the cookie says 'en'). */
export async function getLocale(): Promise<Locale> {
  if (!i18nEnabled()) return DEFAULT_LOCALE;
  const store = await cookies();
  return asLocale(store.get(LOCALE_COOKIE)?.value);
}

/** Convenience: the active locale + its dictionary, for a server component/layout. */
export async function getI18n(): Promise<{ locale: Locale; dict: Dict }> {
  const locale = await getLocale();
  return { locale, dict: getDict(locale) };
}
