"use client";

/**
 * CHEF-PR11 — NL/EN switch for the chef portal. Two tiny pills; the active locale
 * is highlighted. Tapping the other one calls the setLocale server action (cookie
 * + revalidate) inside a transition so the UI stays responsive. Only rendered when
 * the layout decides i18n is enabled — this component assumes it's allowed to show.
 */
import { useTransition } from "react";

import { setLocale } from "@/lib/i18n/set-locale";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const SHORT: Record<Locale, string> = { nl: "NL", en: "EN" };

export function LanguageToggle() {
  const active = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="inline-flex items-center rounded-full border border-ink-200 bg-white p-0.5"
      role="group"
      aria-label="Taal / Language"
    >
      {LOCALES.map((loc) => {
        const isActive = loc === active;
        return (
          <button
            key={loc}
            type="button"
            disabled={pending || isActive}
            onClick={() => startTransition(() => setLocale(loc))}
            aria-pressed={isActive}
            className={`rounded-full px-2 py-0.5 font-ui text-[11px] font-medium tracking-[0.1em] transition ${
              isActive ? "bg-burgundy text-white" : "text-ink-500 hover:text-burgundy"
            } ${pending ? "opacity-60" : ""}`}
          >
            {SHORT[loc]}
          </button>
        );
      })}
    </div>
  );
}
