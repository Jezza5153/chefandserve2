/**
 * /admin/business/tarieven — the rate card: what a role should cost and earn per hour.
 *
 * Until this existed, nothing in the system knew what a sous-chef ought to cost. Both
 * rates were typed by hand on every shift with no prefill and nothing to check against,
 * so €34 where €43 was meant came straight off the margin and surfaced nowhere.
 *
 * A norm, not a rule. `createShift` only uses these to fill a rate that was left blank,
 * and a deviation is remarked on, never blocked — klanten have their own deals and the
 * operator stays the one who decides. settings:write only; values live in
 * `business_settings` under key 'rate_card'.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { getTariefkaart, normMarge, setTariefkaart, type Tariefkaart, type Vakniveau } from "@/lib/domain/rate-card";
import { formatChefRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Tarieven" };
export const dynamic = "force-dynamic";

/** The roles worth carrying a norm. Deliberately not every enum value — "other" has no norm. */
const ROLLEN: Vakniveau[] = [
  "keukenhulp",
  "commis",
  "chef_de_partie",
  "sous_chef",
  "chef_de_cuisine",
  "executive_chef",
  "patissier",
  "banqueting",
  "bediening",
  "host",
  "runner",
  "breakfast",
  "roomservice",
];

const euro = (c: number) => (c / 100).toFixed(2);

async function opslaan(formData: FormData) {
  "use server";
  const session = await requirePermission("settings", "write");
  const kaart: Tariefkaart = {};
  for (const rol of ROLLEN) {
    const klant = parseFloat(String(formData.get(`${rol}_klant`) ?? "").replace(",", ".").trim());
    const chef = parseFloat(String(formData.get(`${rol}_chef`) ?? "").replace(",", ".").trim());
    // Both or neither: one filled side would prefill half a shift and leave the other at
    // zero, which reads on an invoice as "this role is free".
    if (!Number.isFinite(klant) || !Number.isFinite(chef) || klant <= 0 || chef <= 0) continue;
    kaart[rol] = { klantCents: Math.round(klant * 100), chefCents: Math.round(chef * 100) };
  }
  await setTariefkaart(kaart, session.user.id);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "business_settings.rate_card_updated",
    resource: "business_settings",
    resourceId: "rate_card",
    after: { rollen: Object.keys(kaart).length },
  }).catch(() => {});
  revalidatePath("/admin/business/tarieven");
  redirect("/admin/business/tarieven?ok=1");
}

export default async function TarievenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requirePermission("settings", "write");
  const sp = await searchParams;
  const kaart = await getTariefkaart();
  const ingevuld = Object.keys(kaart).length;

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">Tarieven per functie</h1>
        <p className="mt-1 text-sm text-ink-600">
          Wat een functie <strong>hoort</strong> te kosten en te verdienen, per uur. Bij het aanmaken van een dienst
          worden deze bedragen ingevuld als je zelf niets invult — en als je een ander tarief kiest, zegt het systeem
          er iets van maar houdt je nooit tegen.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Dit zijn de kale uurtarieven. Toeslagen voor nacht, weekend of spoed komen hier bovenop en horen niet in
          deze bedragen verwerkt te worden.
        </p>
      </header>

      {sp.ok ? (
        <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-900">
          Opgeslagen. {ingevuld} {ingevuld === 1 ? "functie heeft" : "functies hebben"} nu een norm.
        </p>
      ) : null}

      {ingevuld === 0 ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-900">
          Er staat nog geen enkel standaardtarief. Zolang dat zo is wordt er niets voorgevuld en kan een typefout in
          een tarief nergens opvallen.
        </p>
      ) : null}

      <form action={opslaan} className="mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left">
              <th className="pb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Functie</th>
              <th className="pb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Klant / uur</th>
              <th className="pb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Chef / uur</th>
              <th className="pb-2 text-right font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Marge</th>
            </tr>
          </thead>
          <tbody>
            {ROLLEN.map((rol) => {
              const norm = kaart[rol];
              const marge = norm ? normMarge(norm) : null;
              return (
                <tr key={rol} className="border-b border-ink-200/60">
                  <td className="py-2 text-ink-900">{formatChefRole(rol)}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name={`${rol}_klant`}
                      defaultValue={norm ? euro(norm.klantCents) : ""}
                      placeholder="—"
                      className="w-28 rounded border border-ink-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name={`${rol}_chef`}
                      defaultValue={norm ? euro(norm.chefCents) : ""}
                      placeholder="—"
                      className="w-28 rounded border border-ink-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 text-right text-ink-600">
                    {marge != null ? (
                      <span className={marge < 20 ? "text-amber-700" : ""}>{marge}%</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-3 text-xs text-ink-500">
          Laat beide velden leeg om een functie zonder norm te laten. Eén veld invullen telt niet — dan zou de helft
          van een dienst op € 0,00 komen te staan.
        </p>

        <button
          type="submit"
          className="mt-5 rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
        >
          Opslaan
        </button>
      </form>
    </div>
  );
}
