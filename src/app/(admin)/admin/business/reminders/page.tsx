import { desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { reminderRules } from "@/lib/db/schema";
import type { ReminderRule } from "@/lib/db/schema";
import { requireAnyRole } from "@/lib/permissions";
import { fieldClass as INPUT, btnClass as BTN } from "@/components/forms/Fields";

import { createRule, deleteRule, toggleRule, updateRule } from "./actions";

export const metadata = { title: "Herinneringen", robots: { index: false } };
export const dynamic = "force-dynamic";

const TRIGGERS = ["chef_birthday", "id_document_expiry", "certificate_expiry", "chef_inactivity"] as const;
const CHANNELS = ["email", "in_app", "both"] as const;
const ROLE_OPTS = ["owner", "planner", "super_admin"] as const;

const TRIGGER_LABEL: Record<string, string> = {
  chef_birthday: "Verjaardag chef",
  id_document_expiry: "ID-bewijs verloopt",
  certificate_expiry: "Certificaat verloopt",
  chef_inactivity: "Chef inactief",
};
const CHANNEL_LABEL: Record<string, string> = { email: "E-mail", in_app: "In-app", both: "Beide" };
const FLASH: Record<string, string> = {
  created: "✓ Herinnering aangemaakt.",
  saved: "✓ Herinnering opgeslagen.",
  deleted: "✓ Herinnering verwijderd.",
  invalid: "Controleer naam, trigger en kanaal.",
  "bad-email": "Eén of meer e-mailadressen kloppen niet.",
};


export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAnyRole(["owner", "planner"], "/admin/business");
  const sp = await searchParams;
  const rules = await db.select().from(reminderRules).orderBy(desc(reminderRules.createdAt));
  const flash = sp.ok ? FLASH[sp.ok] : sp.err ? FLASH[sp.err] : null;
  const tone = sp.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-burgundy/30 bg-burgundy/5 text-burgundy";

  return (
    <div className="max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Beheer</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Herinneringen</h1>
      <p className="mt-2 text-sm text-ink-600">
        Automatische herinneringen, bijv. een mail X dagen vóór de verjaardag van een chef. Stel de trigger,
        het aantal dagen vooraf, het kanaal en de ontvangers in.
      </p>

      {flash ? <p className={`mt-4 rounded border px-4 py-2 text-sm ${tone}`}>{flash}</p> : null}

      {/* New rule */}
      <details className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          + Nieuwe herinnering
        </summary>
        <form action={createRule} className="mt-4">
          <RuleFields />
          <button className={`${BTN} mt-4`}>Aanmaken</button>
        </form>
      </details>

      {/* Existing rules */}
      <div className="mt-6 space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Nog geen herinneringen. Maak er een aan met &ldquo;Nieuwe herinnering&rdquo;.
          </div>
        ) : (
          rules.map((r) => (
            <section key={r.id} className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-base text-ink-900">{r.name}</p>
                  <p className="mt-0.5 font-ui text-[10px] uppercase tracking-[0.12em] text-ink-400">
                    {TRIGGER_LABEL[r.triggerType] ?? r.triggerType} · {r.leadDays} dagen vooraf ·{" "}
                    {CHANNEL_LABEL[r.channel] ?? r.channel}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Ontvangers: {r.recipients.length ? r.recipients.join(", ") : "—"}
                    {r.recipientRoles.length ? ` · rollen: ${r.recipientRoles.join(", ")}` : ""}
                    {r.notifySubjectChef ? " · ook de chef zelf" : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    {r.lastRunAt ? `Laatst uitgevoerd: ${new Date(r.lastRunAt).toLocaleString("nl-NL")}` : "Nog niet uitgevoerd"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
                      r.enabled ? "bg-emerald-100 text-emerald-700" : "bg-bg-gray text-ink-500"
                    }`}
                  >
                    {r.enabled ? "Aan" : "Uit"}
                  </span>
                  <form action={toggleRule.bind(null, r.id)}>
                    <button className="rounded-full border border-ink-200 px-3 py-1 font-ui text-[10px] uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy/40">
                      {r.enabled ? "Uitzetten" : "Aanzetten"}
                    </button>
                  </form>
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:text-burgundy">
                  Bewerken
                </summary>
                <form action={updateRule.bind(null, r.id)} className="mt-3">
                  <RuleFields rule={r} />
                  <div className="mt-4 flex gap-2">
                    <button className={BTN}>Opslaan</button>
                    <button
                      formAction={deleteRule.bind(null, r.id)}
                      className="rounded-full border border-red-300 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                    >
                      Verwijderen
                    </button>
                  </div>
                </form>
              </details>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function RuleFields({ rule }: { rule?: ReminderRule }) {
  const params = (rule?.params ?? {}) as { thresholdDays?: number };
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Labelled label="Naam">
          <input name="name" defaultValue={rule?.name ?? ""} placeholder="Verjaardag-mail naar Maarten" className={INPUT} required />
        </Labelled>
        <Labelled label="Trigger">
          <select name="triggerType" defaultValue={rule?.triggerType ?? "chef_birthday"} className={INPUT}>
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Dagen vooraf">
          <input type="number" name="leadDays" min={0} max={365} defaultValue={rule?.leadDays ?? 7} className={INPUT} />
        </Labelled>
        <Labelled label="Kanaal">
          <select name="channel" defaultValue={rule?.channel ?? "email"} className={INPUT}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <Labelled label="Ontvangers (e-mail, komma-gescheiden)">
        <input name="recipients" defaultValue={rule?.recipients.join(", ") ?? ""} placeholder="maarten@chefandserve.nl" className={INPUT} />
      </Labelled>
      <div>
        <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-500">Stuur ook naar rollen</span>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {ROLE_OPTS.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="recipientRoles"
                value={role}
                defaultChecked={rule?.recipientRoles.includes(role) ?? false}
                className="h-4 w-4 rounded border-ink-300 text-burgundy"
              />
              {role}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="notifySubjectChef" defaultChecked={rule?.notifySubjectChef ?? false} className="h-4 w-4 rounded border-ink-300 text-burgundy" />
          Ook de chef zelf
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} className="h-4 w-4 rounded border-ink-300 text-burgundy" />
          Actief
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          Inactief na (dagen)
          <input type="number" name="thresholdDays" min={0} max={365} defaultValue={params.thresholdDays ?? 0} className="w-20 rounded border border-ink-200 bg-white px-2 py-1 text-sm" />
        </label>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}
