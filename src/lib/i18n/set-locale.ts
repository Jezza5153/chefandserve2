"use server";

/**
 * CHEF-PR11 — flip the chef's language. Writes the per-device `cs_locale` cookie
 * and revalidates so the next render picks it up. No DB, no auth lookup needed:
 * it only sets a UI preference cookie scoped to this browser. A no-op when the
 * i18n flag is off, so it can't be used to force EN before the copy is ready.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { i18nEnabled } from "@/lib/i18n/server";
import { asLocale, LOCALE_COOKIE } from "@/lib/i18n/locales";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(next: string): Promise<void> {
  if (!i18nEnabled()) return;
  const locale = asLocale(next);
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false, // a UI preference, not a secret — readable by the client too
  });
  revalidatePath("/chef", "layout");
}
