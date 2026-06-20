/**
 * /admin/business/money-assumptions — CHEF-PR8. Owner-editable tax/wage table
 * behind the Money Explainer + the vakantiegeld estimate. Verifying + tuning these
 * against the current official tables (Belastingdienst loontabellen, Rijksoverheid
 * minimumloon/vakantiegeld) IN-APP is the prerequisite for flipping
 * MONEY_EXPLAINER_ENABLED. settings:write only. Values live in business_settings
 * (key 'money_assumptions'), merged over the code defaults by getMoneyAssumptions().
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getMoneyAssumptions, setMoneyAssumptions } from "@/lib/business-settings";
import { recordAuditFromRequest } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Geld-aannames" };
export const dynamic = "force-dynamic";

const FIELDS: { key: string; label: string; suffix: string; step: string }[] = [
  { key: "minimumWageHour", label: "Minimumloon per uur (€, 21+)", suffix: "€", step: "0.01" },
  { key: "vacationPct", label: "Vakantiegeld", suffix: "%", step: "0.1" },
  { key: "payrollEffectiveTaxPct", label: "Payroll: effectieve loonheffing (indicatie)", suffix: "%", step: "0.1" },
  { key: "noKortingExtraPct", label: "Extra inhouding zonder loonheffingskorting", suffix: "%", step: "0.1" },
  { key: "zzpIncomeTaxReservePct", label: "ZZP: reservering inkomstenbelasting", suffix: "%", step: "0.1" },
  { key: "zzpZvwPct", label: "ZZP: Zvw-bijdrage", suffix: "%", step: "0.1" },
  { key: "vatPct", label: "BTW", suffix: "%", step: "0.1" },
];

async function save(formData: FormData) {
  "use server";
  const session = await requirePermission("settings", "write");
  const patch: Record<string, number | string> = {};
  for (const f of FIELDS) {
    const raw = String(formData.get(f.key) ?? "").replace(",", ".").trim();
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) patch[f.key] = n;
  }
  const source = String(formData.get("source") ?? "").trim();
  if (source) patch.source = source.slice(0, 500);
  // Stamp "last verified" to today (Amsterdam) on every save.
  patch.lastUpdated = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  await setMoneyAssumptions(patch, session.user.id);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "business_settings.money_assumptions_updated",
    resource: "business_settings",
    resourceId: "money_assumptions",
    after: patch,
  }).catch(() => {});
  revalidatePath("/admin/business/money-assumptions");
  redirect("/admin/business/money-assumptions?ok=1");
}

export default async function MoneyAssumptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requirePermission("settings", "write");
  const sp = await searchParams;
  const a = await getMoneyAssumptions();
  const val = (k: string) => String((a as unknown as Record<string, number>)[k] ?? "");

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Instellingen</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Geld-aannames</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Deze waarden voeden de <strong>Geld uitgelegd</strong>-rekenhulp + de
        vakantiegeld-schatting van chefs. Het zijn <strong>indicaties</strong>, geen
        loonstrook of belastingadvies. Controleer ze tegen de actuele officiële tabellen
        vóór je <code>MONEY_EXPLAINER_ENABLED</code> aanzet.
      </p>

      {sp.ok ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Opgeslagen — bijgewerkt op {a.lastUpdated}.
        </p>
      ) : null}

      <form action={save} className="mt-6 space-y-4 rounded-lg border border-ink-200 bg-white p-6">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-800">{f.label}</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                name={f.key}
                step={f.step}
                min={0}
                defaultValue={val(f.key)}
                inputMode="decimal"
                className="w-28 rounded-md border border-ink-200 px-3 py-2 text-right text-sm focus:border-burgundy focus:outline-none"
              />
              <span className="w-4 text-sm text-ink-500">{f.suffix}</span>
            </span>
          </label>
        ))}
        <label className="block">
          <span className="text-sm text-ink-800">Bron / toelichting</span>
          <textarea
            name="source"
            rows={2}
            defaultValue={a.source}
            className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-burgundy focus:outline-none"
          />
        </label>
        <p className="text-xs text-ink-400">Opslaan stempelt de datum "laatst gecontroleerd" op vandaag.</p>
        <button className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900">
          Opslaan
        </button>
      </form>
    </div>
  );
}
