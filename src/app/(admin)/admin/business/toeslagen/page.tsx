/**
 * /admin/business/toeslagen — where finance enters the cao surcharge rules.
 *
 * The percentages, the windows and which days count as weekend are a cao question, not a
 * developer's guess, so nothing is hard-coded: this screen is empty on delivery and the
 * engine computes nothing until someone fills it in. That is also the safe launch — every
 * amount stays exactly what it is today until a rule is switched on.
 *
 * Three public marketing pages promise "een toeslag conform horeca-cao", so leaving this
 * empty is a standing commercial and cao exposure. The banner at the top says so.
 *
 * settings:write only.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import {
  deleteSurchargeRule,
  listSurchargeRules,
  upsertSurchargeRule,
  type RegelInvoer,
} from "@/lib/domain/surcharges";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Toeslagen" };
export const dynamic = "force-dynamic";

const SOORT_LABEL: Record<RegelInvoer["kind"], string> = {
  time_window: "Tijdvenster (bv. nacht)",
  weekday: "Weekdagen (bv. weekend)",
  holiday: "Feestdagen",
  spoed: "Spoed (kort van tevoren)",
};

const DAGEN = [
  { nr: 1, kort: "ma" }, { nr: 2, kort: "di" }, { nr: 3, kort: "wo" }, { nr: 4, kort: "do" },
  { nr: 5, kort: "vr" }, { nr: 6, kort: "za" }, { nr: 7, kort: "zo" },
];

const tijd = (min: number | null) =>
  min == null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const naarMinuten = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const u = Number(m[1]), min = Number(m[2]);
  if (u > 24 || min > 59) return null;
  return (u % 24) * 60 + min;
};

async function opslaan(formData: FormData) {
  "use server";
  const session = await requirePermission("settings", "write");
  const kind = String(formData.get("kind") ?? "time_window") as RegelInvoer["kind"];
  const invoer: RegelInvoer = {
    code: String(formData.get("code") ?? ""),
    label: String(formData.get("label") ?? ""),
    kind,
    startMinuteOfDay: kind === "time_window" ? naarMinuten(String(formData.get("start") ?? "")) : null,
    endMinuteOfDay: kind === "time_window" ? naarMinuten(String(formData.get("eind") ?? "")) : null,
    weekdays: kind === "weekday" ? formData.getAll("weekdays").map((d) => Number(d)).filter(Boolean) : null,
    leadTimeHours: kind === "spoed" ? Number(formData.get("leadTimeHours") ?? 0) || null : null,
    clientPctBps: Math.round(Number(String(formData.get("clientPct") ?? "0").replace(",", ".")) * 100),
    chefPctBps: Math.round(Number(String(formData.get("chefPct") ?? "0").replace(",", ".")) * 100),
    priority: Number(formData.get("priority") ?? 0),
    enabled: formData.get("enabled") === "on",
  };

  const res = await upsertSurchargeRule(invoer, session.user.id);
  if (!res.ok) redirect(`/admin/business/toeslagen?error=${encodeURIComponent(res.error)}`);

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "surcharge_rules.upserted",
    resource: "surcharge_rules",
    resourceId: invoer.code,
    after: { kind: invoer.kind, clientPctBps: invoer.clientPctBps, chefPctBps: invoer.chefPctBps, enabled: invoer.enabled },
  }).catch(() => {});
  revalidatePath("/admin/business/toeslagen");
  redirect("/admin/business/toeslagen?ok=1");
}

async function verwijderen(formData: FormData) {
  "use server";
  const session = await requirePermission("settings", "write");
  const code = String(formData.get("code") ?? "");
  if (!code) redirect("/admin/business/toeslagen");
  await deleteSurchargeRule(code);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "surcharge_rules.deleted",
    resource: "surcharge_rules",
    resourceId: code,
  }).catch(() => {});
  revalidatePath("/admin/business/toeslagen");
  redirect("/admin/business/toeslagen?ok=verwijderd");
}

export default async function ToeslagenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("settings", "write");
  const sp = await searchParams;
  const regels = await listSurchargeRules();
  const actief = regels.filter((r) => r.enabled && (r.clientPctBps > 0 || r.chefPctBps > 0));

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">Toeslagen</h1>
        <p className="mt-1 text-sm text-ink-600">
          Wat er bovenop het kale uurtarief komt bij nacht-, weekend-, feestdag- of spoedwerk. Vul hier de
          cao-percentages in; het systeem rekent er niets bij zolang er geen regel aanstaat.
        </p>
      </header>

      {sp.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50/60 px-4 py-2.5 text-sm text-red-900">{sp.error}</p>
      ) : null}
      {sp.ok ? (
        <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-900">
          {sp.ok === "verwijderd" ? "Regel verwijderd. Al berekende bedragen blijven ongewijzigd." : "Opgeslagen."}
        </p>
      ) : null}

      {actief.length === 0 ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
          <strong>Er staat nog geen enkele toeslag aan.</strong> Op onze eigen website staat wél dat nacht-, weekend- en
          spoeddiensten een toeslag conform horeca-cao kennen. Zolang hier niets is ingevuld, wordt die toeslag nergens
          berekend en verdwijnt hij in het uurtarief — onzichtbaar voor de klant, de chef en de marge.
        </p>
      ) : null}

      {/* Bestaande regels */}
      <section className="mt-8">
        <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Regels</h2>
        {regels.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nog geen regels.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-200/60 rounded-lg border border-ink-200 bg-white">
            {regels.map((r) => (
              <li key={r.code} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <strong className="text-ink-900">{r.label}</strong>{" "}
                  <span className="text-ink-500">({r.code})</span>
                  <span className="ml-2 rounded-full bg-bg-gray px-2 py-0.5 font-ui text-[10px] uppercase tracking-wider text-ink-500">
                    {SOORT_LABEL[r.kind]}
                  </span>
                  {!r.enabled ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[10px] uppercase tracking-wider text-amber-800">
                      uit
                    </span>
                  ) : null}
                  <span className="ml-2 text-ink-600">
                    {r.kind === "time_window" ? `${tijd(r.startMinuteOfDay)}–${tijd(r.endMinuteOfDay)}` : null}
                    {r.kind === "weekday"
                      ? (r.weekdays ?? []).map((d) => DAGEN.find((x) => x.nr === d)?.kort).join(", ")
                      : null}
                    {r.kind === "spoed" ? `< ${r.leadTimeHours} uur vooraf` : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-ink-600">
                  <span>
                    klant <strong className="text-ink-900">+{(r.clientPctBps / 100).toFixed(1)}%</strong> · chef{" "}
                    <strong className="text-ink-900">+{(r.chefPctBps / 100).toFixed(1)}%</strong>
                  </span>
                  <span className="text-ink-400">prio {r.priority}</span>
                  <form action={verwijderen}>
                    <input type="hidden" name="code" value={r.code} />
                    <button type="submit" className="font-ui text-[10px] uppercase tracking-wider text-ink-400 hover:text-red-700">
                      verwijderen
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-500">
          Overlappen twee regels op hetzelfde moment, dan wint de hoogste prioriteit — er wordt niet gestapeld. Een
          zondagnacht betaalt dus het zondagtarief óf het nachttarief, niet allebei.
        </p>
      </section>

      {/* Nieuwe of bestaande regel */}
      <section className="mt-10 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Regel toevoegen of wijzigen</h2>
        <p className="mt-1 text-sm text-ink-500">
          Een bestaande code overschrijven werkt de regel bij. Wijzigingen gelden alleen voor uren die dáárna worden
          goedgekeurd — al berekende bedragen blijven staan.
        </p>

        <form action={opslaan} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Code</span>
            <input name="code" required placeholder="nacht" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Naam (komt op de factuur)</span>
            <input name="label" required placeholder="Nachttoeslag" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Soort</span>
            <select name="kind" className="rounded border border-ink-300 px-2 py-1.5 text-sm" defaultValue="time_window">
              {(Object.keys(SOORT_LABEL) as RegelInvoer["kind"][]).map((k) => (
                <option key={k} value={k}>{SOORT_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Prioriteit (hoger wint)</span>
            <input name="priority" type="number" defaultValue={0} className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
          </label>

          <fieldset className="rounded border border-ink-200 p-3 sm:col-span-2">
            <legend className="px-1 font-ui text-[10px] uppercase tracking-wider text-ink-500">
              Vul alleen in wat bij de gekozen soort hoort
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-600">Tijdvenster van</span>
                <input name="start" placeholder="00:00" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-600">tot</span>
                <input name="eind" placeholder="06:00" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-600">Spoed: binnen … uur vooraf</span>
                <input name="leadTimeHours" type="number" min="1" placeholder="24" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <span className="text-xs text-ink-600">Weekdagen:</span>
              {DAGEN.map((d) => (
                <label key={d.nr} className="flex items-center gap-1 text-xs text-ink-700">
                  <input type="checkbox" name="weekdays" value={d.nr} /> {d.kort}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Toeslag klant (%)</span>
            <input name="clientPct" type="number" step="0.1" min="0" defaultValue="0" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-ui text-[10px] uppercase tracking-wider text-ink-500">Toeslag chef (%)</span>
            <input name="chefPct" type="number" step="0.1" min="0" defaultValue="0" className="rounded border border-ink-300 px-2 py-1.5 text-sm" />
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
            <input type="checkbox" name="enabled" /> Meteen aanzetten
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
            >
              Opslaan
            </button>
          </div>
        </form>
      </section>

      <p className="mt-6 text-xs text-ink-500">
        Over pauze: een onbetaalde pauze wordt evenredig over de gewerkte uren verdeeld. Bij een dienst die half in en
        half buiten een toeslagvenster valt, gaat de pauze dus voor de helft van elk af. Wijkt de cao daarvan af, laat
        het weten — dat is één plek in de berekening.
      </p>
    </div>
  );
}
