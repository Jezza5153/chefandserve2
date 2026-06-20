/**
 * CHEF-PR11 — pure dictionary lookup. No server-only imports, so this is safe to
 * call from a client component too (the LocaleProvider re-derives the dict on the
 * client). Dutch is always the fallback.
 */
import { en } from "@/lib/i18n/dictionaries/en";
import { nl, type Dict } from "@/lib/i18n/dictionaries/nl";
import { type Locale } from "@/lib/i18n/locales";

const DICTS: Record<Locale, Dict> = { nl, en };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? nl;
}

export type { Dict };
