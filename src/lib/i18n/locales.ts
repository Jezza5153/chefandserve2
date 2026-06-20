/**
 * CHEF-PR11 — i18n primitives (no React, no server-only imports, safe everywhere).
 *
 * Many chefs read English more comfortably than Dutch, so the chef portal gets a
 * NL/EN toggle. The preference lives in a per-device cookie (`cs_locale`) — a
 * language choice is naturally per-device, and a cookie keeps it off the shared
 * `chefs` table entirely. Dutch stays the default everywhere, so nothing changes
 * for an existing user until they switch (and only when I18N_ENABLED is on).
 */
export const LOCALES = ["nl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "nl";

/** The cookie that carries the chef's chosen language across requests. */
export const LOCALE_COOKIE = "cs_locale";

/** Narrow any string to a known Locale, falling back to Dutch. */
export function asLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "nl";
}

/** Human label for a locale, in its OWN language (for the toggle). */
export const LOCALE_LABEL: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
};

/**
 * Fill `{placeholder}` slots in a dictionary string, e.g.
 * fill("komende {days} dagen", { days: 14 }) → "komende 14 dagen".
 * Missing vars become an empty string (never the literal "undefined").
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : "",
  );
}

/** Intl locale tag for date/number formatting in the active app locale. */
export const INTL_TAG: Record<Locale, string> = {
  nl: "nl-NL",
  en: "en-GB",
};
