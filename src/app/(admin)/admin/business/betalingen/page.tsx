/**
 * /admin/business/betalingen — de agency betaalt haar chefs zelf.
 *
 * Payingit deed dit; nu doet het bureau het. Drie stappen met een mens ertussen:
 * samenstellen → bestand downloaden → bevestigen dat de bank het heeft uitgevoerd.
 * Het systeem praat niet met de bank, en dat is bewust: een verkeerde factuur corrigeer
 * je, een verkeerde overboeking moet je terugvragen.
 *
 * Chefs zonder (geldig) rekeningnummer staan apart in beeld in plaats van stil weggelaten
 * te worden — anders wacht iemand op geld dat nooit vertrekt en ziet niemand waarom.
 */
import { redirect } from "next/navigation";

import {
  getTeBetalen,
  listBetaalbatches,
  maakBetaalbatch,
  markeerBetaald,
} from "@/lib/domain/betaalbatch";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Betalingen" };
export const dynamic = "force-dynamic";

const euro = (c: number) => `€ ${(c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  concept: "samengesteld",
  generated: "bestand gemaakt",
  paid: "betaald",
  cancelled: "geannuleerd",
};

/** Wat er nú moet gebeuren — geen ruwe status zonder vervolgstap. */
const VOLGENDE_STAP: Record<string, string> = {
  concept: "download het bankbestand",
  generated: "upload bij de bank, bevestig daarna hieronder",
  paid: "klaar",
  cancelled: "—",
};

async function batchAanmaken(formData: FormData) {
  "use server";
  const session = await requirePermission("payroll", "write");
  const ids = formData.getAll("factuur").map(String).filter(Boolean);
  const datum = String(formData.get("uitvoerDatum") ?? "");
  const res = await maakBetaalbatch({
    chefInvoiceIds: ids,
    uitvoerDatum: datum,
    actorUserId: session.user.id,
    notitie: String(formData.get("notitie") ?? "") || undefined,
  });
  redirect(res.ok ? `/admin/business/betalingen?ok=${res.nummer}` : `/admin/business/betalingen?error=${encodeURIComponent(res.error)}`);
}

async function betaaldMarkeren(formData: FormData) {
  "use server";
  const session = await requirePermission("payroll", "write");
  const res = await markeerBetaald(String(formData.get("batchId") ?? ""), session.user.id);
  redirect(res.ok ? `/admin/business/betalingen?ok=${res.aantal}-betaald` : `/admin/business/betalingen?error=${encodeURIComponent(res.error)}`);
}

export default async function BetalingenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("payroll", "write");
  const sp = await searchParams;
  const [open, batches] = await Promise.all([getTeBetalen(), listBetaalbatches(15)]);
  const betaalbaar = open.filter((t) => t.betaalbaar);
  const geblokkeerd = open.filter((t) => !t.betaalbaar);
  const morgen = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">Betalingen aan chefs</h1>
        <p className="mt-1 text-sm text-ink-600">
          Stel een batch samen, download het bestand voor de bank, en bevestig daarna dat het is uitgevoerd. Pas bij
          die bevestiging staat een factuur op betaald — een bestand maken is nog geen betaling.
        </p>
      </header>

      {sp.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50/60 px-4 py-2.5 text-sm text-red-900">{sp.error}</p>
      ) : null}
      {sp.ok ? (
        <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-900">
          ✓ {sp.ok.endsWith("-betaald") ? `${sp.ok.replace("-betaald", "")} facturen op betaald gezet.` : `Batch ${sp.ok} aangemaakt.`}
        </p>
      ) : null}

      {/* Wat wacht op geld */}
      <section className="mt-8">
        <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Openstaand</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">
            Er staat geen goedgekeurde chef-factuur open. Zodra je er één goedkeurt verschijnt hij hier.
          </p>
        ) : (
          <form action={batchAanmaken} className="mt-3 rounded-lg border border-ink-200 bg-white p-4">
            <ul className="divide-y divide-ink-200/60">
              {betaalbaar.map((t) => (
                <li key={t.chefInvoiceId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <label className="flex items-center gap-2.5">
                    <input type="checkbox" name="factuur" value={t.chefInvoiceId} defaultChecked />
                    <span className="text-ink-900">{t.chefNaam}</span>
                    <span className="text-ink-500">
                      {t.referentie ? `factuur ${t.referentie}` : "geen factuurnummer"}
                      {t.periode ? ` · ${t.periode}` : ""}
                    </span>
                  </label>
                  <strong className="text-ink-900">{euro(t.bedragCents)}</strong>
                </li>
              ))}
            </ul>

            {geblokkeerd.length > 0 ? (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-900">
                <strong>{geblokkeerd.length} chef(s) kunnen niet betaald worden.</strong>
                <ul className="mt-1 space-y-0.5">
                  {geblokkeerd.map((t) => (
                    <li key={t.chefInvoiceId}>
                      {t.chefNaam} — {t.reden} ({euro(t.bedragCents)})
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs">
                  Vul het rekeningnummer aan op de chefpagina; daarna verschijnen ze vanzelf in de lijst hierboven.
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-ink-200/60 pt-4">
              <label className="flex flex-col gap-1">
                <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Uitvoerdatum</span>
                <input
                  type="date"
                  name="uitvoerDatum"
                  defaultValue={morgen}
                  required
                  className="rounded border border-ink-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Notitie (optioneel)</span>
                <input name="notitie" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>
              <button
                type="submit"
                disabled={betaalbaar.length === 0}
                className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Batch samenstellen ({betaalbaar.length})
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Batches */}
      <section className="mt-10">
        <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Betaalbatches</h2>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nog geen batches.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-200/60 rounded-lg border border-ink-200 bg-white">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <strong className="text-ink-900">{b.nummer}</strong>
                  <span className="ml-2 text-ink-600">
                    {b.aantalRegels} {b.aantalRegels === 1 ? "betaling" : "betalingen"} · {euro(b.totaalCents)} ·
                    uitvoerdatum {b.uitvoerDatum}
                  </span>
                  <span className="ml-2 rounded-full bg-bg-gray px-2 py-0.5 font-ui text-[10px] uppercase tracking-wider text-ink-600">
                    {STATUS_LABEL[b.status] ?? b.status}
                  </span>
                  <span className="ml-2 text-xs text-ink-500">→ {VOLGENDE_STAP[b.status] ?? ""}</span>
                </span>
                <span className="flex items-center gap-3">
                  {b.status !== "cancelled" && b.status !== "paid" ? (
                    <a
                      href={`/admin/business/betalingen/${b.id}/sepa.xml`}
                      className="font-ui text-[10px] uppercase tracking-wider text-burgundy hover:underline"
                    >
                      Bankbestand ↓
                    </a>
                  ) : null}
                  {b.status === "generated" ? (
                    <form action={betaaldMarkeren}>
                      <input type="hidden" name="batchId" value={b.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-emerald-400 px-3 py-1 font-ui text-[10px] uppercase tracking-wider text-emerald-800 hover:bg-emerald-50"
                      >
                        Bank heeft uitgevoerd
                      </button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-ink-500">
        Het bestand is een SEPA-batchopdracht (pain.001.001.03) die je bij je bank uploadt. Dit systeem heeft geen
        toegang tot de bankrekening — er vertrekt geen euro zonder dat iemand het bestand daar zelf indient.
      </p>
    </div>
  );
}
