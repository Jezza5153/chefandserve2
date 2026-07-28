/**
 * /admin/business/chefs/bericht — one message to a filtered group of chefs.
 *
 * The move this exists for: someone drops out at 09:40 and you need every sous-chef in
 * Amsterdam to hear about it in one action, not thirty.
 *
 * The screen is deliberately two steps. You filter and SEE the list — names, how many, who
 * cannot be reached — and only then does a send button appear, carrying the number you were
 * shown. If the group changed in between, the domain refuses. A message to the wrong people
 * cannot be recalled, so the confirmation is part of the feature rather than a nicety.
 *
 * Dark-launched: with BULK_MESSAGE_ENABLED unset the page still previews, so the selection
 * can be tried out safely, but sending is refused.
 */
import { redirect } from "next/navigation";

import {
  MAX_ONTVANGERS,
  bulkMessageEnabled,
  previewBulkMessage,
  sendBulkMessage,
} from "@/lib/domain/bulk-message";
import { formatChefRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Bericht aan een groep chefs" };
export const dynamic = "force-dynamic";

const NIVEAUS = [
  "keukenhulp", "commis", "chef_de_partie", "sous_chef", "chef_de_cuisine",
  "executive_chef", "patissier", "banqueting", "bediening",
];

type Zoek = { q?: string; city?: string; vakniveau?: string; verzonden?: string; error?: string; aantal?: string };

function filterUit(sp: Zoek) {
  return {
    ...(sp.q ? { q: sp.q } : {}),
    ...(sp.city ? { city: sp.city } : {}),
    ...(sp.vakniveau ? { vakniveau: sp.vakniveau } : {}),
    limit: MAX_ONTVANGERS + 1,
  };
}

async function versturen(formData: FormData) {
  "use server";
  const session = await requirePermission("chefs", "write");
  const sp: Zoek = {
    q: String(formData.get("q") ?? "") || undefined,
    city: String(formData.get("city") ?? "") || undefined,
    vakniveau: String(formData.get("vakniveau") ?? "") || undefined,
  };
  const terug = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) terug.set(k, v);

  const res = await sendBulkMessage({
    filter: filterUit(sp),
    onderwerp: String(formData.get("onderwerp") ?? ""),
    bericht: String(formData.get("bericht") ?? ""),
    verwachtAantal: Number(formData.get("verwachtAantal") ?? -1),
    actorUserId: session.user.id,
  });

  if (res.ok) {
    terug.set("verzonden", "1");
    terug.set("aantal", String(res.verstuurd));
  } else {
    terug.set("error", res.error);
  }
  redirect(`/admin/business/chefs/bericht?${terug.toString()}`);
}

export default async function GroepsberichtPage({ searchParams }: { searchParams: Promise<Zoek> }) {
  await requirePermission("chefs", "write");
  const sp = await searchParams;
  const heeftFilter = Boolean(sp.q || sp.city || sp.vakniveau);
  const voorbeeld = heeftFilter ? await previewBulkMessage(filterUit(sp)) : null;
  const aanstaan = bulkMessageEnabled();

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">Bericht aan een groep chefs</h1>
        <p className="mt-1 text-sm text-ink-600">
          Filter de groep, kijk wie het krijgt, en verstuur dan pas. Je ziet altijd eerst de namen — een verstuurd
          bericht kun je niet terughalen.
        </p>
      </header>

      {sp.verzonden ? (
        <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-900">
          ✓ Verstuurd naar {sp.aantal} {Number(sp.aantal) === 1 ? "chef" : "chefs"}.
        </p>
      ) : null}
      {sp.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50/60 px-4 py-2.5 text-sm text-red-900">{sp.error}</p>
      ) : null}
      {!aanstaan ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-900">
          Groepsberichten staan nog uit. Je kunt de selectie hier wel uitproberen; versturen lukt pas als{" "}
          <code>BULK_MESSAGE_ENABLED</code> aanstaat.
        </p>
      ) : null}

      {/* Stap 1 — de groep */}
      <form method="get" className="mt-8 flex flex-wrap items-end gap-3 rounded-lg border border-ink-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Zoekterm</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="naam, specialisme…" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Plaats</span>
          <input name="city" defaultValue={sp.city ?? ""} placeholder="Amsterdam" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Vakniveau</span>
          <select name="vakniveau" defaultValue={sp.vakniveau ?? ""} className="rounded border border-ink-300 px-2 py-1.5 text-sm">
            <option value="">alle</option>
            {NIVEAUS.map((n) => (
              <option key={n} value={n}>{formatChefRole(n)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-full border border-ink-300 px-4 py-2 font-ui text-[11px] uppercase tracking-[0.15em] text-ink-700 hover:bg-bg-gray">
          Toon de groep
        </button>
      </form>

      {/* Stap 2 — wie het krijgt */}
      {voorbeeld ? (
        voorbeeld.teGroot ? (
          <p className="mt-6 rounded-lg border border-red-300 bg-red-50/60 px-4 py-3 text-sm text-red-900">
            Deze selectie raakt meer dan {MAX_ONTVANGERS} chefs. Maak hem kleiner — een groep van deze omvang is
            vrijwel altijd een filter die niet doet wat je denkt.
          </p>
        ) : voorbeeld.ontvangers.length === 0 ? (
          <p className="mt-6 rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
            Deze selectie levert niemand op.
          </p>
        ) : (
          <>
            <section className="mt-6 rounded-lg border border-ink-200 bg-white p-4">
              <h2 className="font-serif text-lg text-ink-900">
                {voorbeeld.ontvangers.length} {voorbeeld.ontvangers.length === 1 ? "chef krijgt" : "chefs krijgen"} dit bericht
              </h2>
              <p className="mt-1 text-sm text-ink-600">{voorbeeld.ontvangers.map((o) => o.naam).join(" · ")}</p>
              {voorbeeld.onbereikbaar.length > 0 ? (
                <p className="mt-2 text-sm text-amber-800">
                  {voorbeeld.onbereikbaar.length} chef(s) vallen erbuiten: geen e-mailadres en geen portaalaccount —{" "}
                  {voorbeeld.onbereikbaar.map((o) => o.naam).join(", ")}.
                </p>
              ) : null}
            </section>

            {/* Stap 3 — het bericht */}
            <form action={versturen} className="mt-6 rounded-lg border border-ink-200 bg-white p-4">
              <input type="hidden" name="q" value={sp.q ?? ""} />
              <input type="hidden" name="city" value={sp.city ?? ""} />
              <input type="hidden" name="vakniveau" value={sp.vakniveau ?? ""} />
              {/* Het aantal dat je op dit scherm zag; de domeinlaag weigert als de groep intussen wijzigde. */}
              <input type="hidden" name="verwachtAantal" value={voorbeeld.ontvangers.length} />

              <label className="flex flex-col gap-1">
                <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Onderwerp</span>
                <input name="onderwerp" required placeholder="Wie kan vanavond 17:00 in Amsterdam?" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="mt-3 flex flex-col gap-1">
                <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Bericht</span>
                <textarea name="bericht" required rows={5} placeholder="Schrijf hier wat je wilt vragen of melden." className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>

              <button
                type="submit"
                disabled={!aanstaan}
                className="mt-4 rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Versturen naar {voorbeeld.ontvangers.length} {voorbeeld.ontvangers.length === 1 ? "chef" : "chefs"}
              </button>
              <p className="mt-2 text-xs text-ink-500">
                Iedereen krijgt hetzelfde bericht, per e-mail en in het portaal. Wat je verstuurt wordt vastgelegd in de
                audit-log.
              </p>
            </form>
          </>
        )
      ) : (
        <p className="mt-6 text-sm text-ink-500">Kies eerst een filter om te zien wie het bericht zou krijgen.</p>
      )}
    </div>
  );
}
