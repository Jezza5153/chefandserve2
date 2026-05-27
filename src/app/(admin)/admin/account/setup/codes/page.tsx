/**
 * Setup step 3 — show recovery codes ONCE, require acknowledgement.
 *
 * On acknowledge: clear the codes cookie + redirect to the default landing.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { defaultLandingFor, requireAuth } from "@/lib/permissions";

import { WizardShell } from "../_components/WizardShell";

export const metadata = {
  title: "Bewaar je recovery codes",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const CODES_COOKIE = "cs_2fa_codes";

async function acknowledge() {
  "use server";
  const session = await requireAuth("/admin/account/setup");
  (await cookies()).delete(CODES_COOKIE);
  redirect(defaultLandingFor(session.user.roles ?? []));
}

export default async function SetupCodesPage() {
  await requireAuth("/admin/account/setup");

  const cookieStore = await cookies();
  const raw = cookieStore.get(CODES_COOKIE)?.value;
  if (!raw) redirect("/admin/account/setup");

  let codes: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) codes = parsed.filter((c) => typeof c === "string");
  } catch {
    redirect("/admin/account/setup");
  }
  if (codes.length === 0) redirect("/admin/account/setup");

  return (
    <WizardShell current={3}>
      <h1 className="font-serif text-4xl text-ink-900 md:text-5xl">
        Bewaar deze codes op een veilige plek
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700 md:text-base">
        Elke code werkt <strong>één keer</strong>. Gebruik ze alleen wanneer je
        geen toegang hebt tot je authenticator-app. Print ze, schrijf ze op,
        of zet ze in een password manager — maar <strong>niet</strong> in
        dezelfde authenticator (dan beschermen ze je niet meer als je je
        telefoon kwijtraakt).
      </p>

      <div className="mt-10 rounded-lg border border-burgundy/30 bg-burgundy/5 p-6">
        <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
          Eenmalig zichtbaar — sluit dit tabblad nog niet
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2">
          {codes.map((code) => (
            <li
              key={code}
              className="rounded bg-white px-4 py-2 font-mono text-sm tracking-wider text-ink-900"
            >
              {code}
            </li>
          ))}
        </ul>
      </div>

      <form action={acknowledge} className="mt-10">
        <label className="flex items-start gap-3 text-sm text-ink-700">
          <input
            type="checkbox"
            required
            className="mt-1 size-4 rounded border-ink-200 text-burgundy focus:ring-burgundy"
          />
          <span>
            Ik heb deze {codes.length} codes opgeslagen op een veilige plek
            buiten mijn authenticator.
          </span>
        </label>
        <button
          type="submit"
          className="mt-6 rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Klaar — naar het dashboard
        </button>
      </form>
    </WizardShell>
  );
}
