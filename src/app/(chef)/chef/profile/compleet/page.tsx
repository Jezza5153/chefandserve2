/**
 * /chef/profile/compleet — "Maak je profiel compleet" (CV-AI-1, chef side).
 *
 * No AI chat, no raw CV text. Two blocks:
 *   1. Completeness gaps (getProfileCompleteness, labels only) → link to the
 *      profile editor.
 *   2. Pending AI suggestions (from the chef's CV) → Accept / Negeer.
 *
 * Accept routes by field-class (in the domain): a SAFE field writes the chef
 * directly; vakniveau (sensitive) files a profile_change_request for the owner.
 * Every action is ownership-scoped (auth IS the lookup + expectChefId guard).
 */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getProfileCompleteness } from "@/lib/domain/profile-completeness";
import {
  SUGGESTION_FIELD_LABEL,
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
} from "@/lib/domain/profile-suggestions";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Profiel compleet maken" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

function formatVal(field: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "vakniveau" && typeof value === "string") return formatChefRole(value);
  if (Array.isArray(value)) return value.join(", ");
  if (field === "yearsExperience") return `${value} jaar`;
  return String(value);
}

export default async function ChefProfileCompleetPage() {
  const session = await requireAuth("/chef/profile/compleet");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) {
    return (
      <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        Geen chef-profiel gekoppeld aan dit account.
      </p>
    );
  }

  const completeness = getProfileCompleteness({
    vakniveau: chef.vakniveau,
    city: chef.city,
    segments: chef.segments,
    yearsExperience: chef.yearsExperience,
    hourlyRateMinCents: chef.hourlyRateMinCents,
    hourlyRateMaxCents: chef.hourlyRateMaxCents,
    email: chef.email,
    phone: chef.phone,
    specialties: chef.specialties,
    languages: chef.languages,
    postcode: chef.postcode,
    transportMode: chef.transportMode,
    preferences: chef.preferences,
  });
  const suggestions = await listPendingSuggestions(chef.id);

  async function acceptAction(formData: FormData) {
    "use server";
    const s = await requireAuth();
    const me = await db.query.chefs.findFirst({ where: eq(chefs.userId, s.user.id) });
    if (!me) return;
    const suggestionId = String(formData.get("suggestionId") ?? "");
    if (!suggestionId) return;
    const res = await acceptSuggestion({
      suggestionId,
      decidedBy: s.user.id,
      actorKind: "chef",
      expectChefId: me.id, // ownership — only this chef's own suggestions
    });
    redirect(`/chef/profile/compleet?ok=${res.ok ? res.applied : "gone"}`);
  }

  async function dismissAction(formData: FormData) {
    "use server";
    const s = await requireAuth();
    const me = await db.query.chefs.findFirst({ where: eq(chefs.userId, s.user.id) });
    if (!me) return;
    const suggestionId = String(formData.get("suggestionId") ?? "");
    if (!suggestionId) return;
    await dismissSuggestion({ suggestionId, decidedBy: s.user.id, expectChefId: me.id });
    redirect(`/chef/profile/compleet?ok=dismissed`);
  }

  const missing = [...completeness.missingCritical, ...completeness.missingNiceToHave];

  return (
    <div>
      <p className={LABEL}>Profiel</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Maak je profiel compleet</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Hoe completer je profiel, hoe vaker we je kunnen voorstellen voor passende shifts.
        Je profiel is nu <strong>{completeness.score}%</strong> ({completeness.label}).
      </p>

      {/* Completeness gaps */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Wat mist er nog</p>
        {missing.length === 0 ? (
          <p className="mt-2 text-sm text-ink-700">Je profiel is helemaal compleet. Top! 🎉</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {missing.map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs capitalize text-amber-800"
                >
                  {m}
                </span>
              ))}
            </div>
            <Link
              href="/chef/profile"
              className="mt-4 inline-block rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy/90"
            >
              Profiel bijwerken
            </Link>
          </>
        )}
      </section>

      {/* AI suggestions from CV */}
      {suggestions.length > 0 ? (
        <section className="mt-6 rounded-lg border border-sky-300 bg-sky-50/40 p-5">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-sky-800">
            Voorstellen uit je CV
          </p>
          <p className="mt-1 text-sm text-ink-700">
            We lazen je CV en stellen deze aanvullingen voor. Jij beslist.
          </p>
          <ul className="mt-4 space-y-4">
            {suggestions.map((s) => (
              <li key={s.id} className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                  {SUGGESTION_FIELD_LABEL[s.field] ?? s.field}
                </p>
                <div className="mt-2 grid gap-1 text-sm text-ink-900">
                  <p>
                    <span className="text-ink-500">Nu:</span> {formatVal(s.field, s.currentValue)}
                  </p>
                  <p>
                    <span className="text-ink-500">Voorstel:</span>{" "}
                    <strong>{formatVal(s.field, s.proposedValue)}</strong>
                  </p>
                  {s.fieldClass === "sensitive" ? (
                    <p className="text-xs text-ink-500">
                      Dit veld gaat eerst ter goedkeuring naar kantoor.
                    </p>
                  ) : null}
                </div>
                <form action={acceptAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="suggestionId" value={s.id} />
                  <button
                    type="submit"
                    className="rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
                  >
                    Toevoegen
                  </button>
                  <button
                    type="submit"
                    formAction={dismissAction}
                    className="rounded-full border border-ink-300 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-600 hover:bg-bg-gray"
                  >
                    Negeren
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-xs text-ink-500">
        Terug naar je{" "}
        <Link href="/chef/profile" className="text-burgundy hover:underline">
          profiel
        </Link>
        .
      </p>
    </div>
  );
}
