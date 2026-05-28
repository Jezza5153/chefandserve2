/**
 * /admin/account/instellingen — per-employee settings hub (Cockpit PR-1.7).
 *
 * Every internal user fine-tunes the cockpit to what THEY need. V1 sections:
 *   - Rooster: critical lead-time (uren), default view, next-action wording
 *     (feeds src/lib/roster-format via user-settings → zero code change).
 *   - Meldingen: per-user notification toggles (notification_prefs).
 * Generic backing store (user_settings.prefs jsonb) so new sections need no migration.
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { notificationPrefs } from "@/lib/db/schema";
import { getRosterSettings, saveRosterSettings, type StoredRosterSettings } from "@/lib/domain/user-settings";
import { setPref } from "@/lib/integrations/prefs";
import { DEFAULT_ROSTER_SETTINGS } from "@/lib/roster-format";
import { ALL_EVENTS, EVENT_LABELS } from "@/lib/notifications";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Instellingen" };
export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls = "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";

/** Roster next-action labels, with a human description of when each fires. */
const LABEL_FIELDS: { key: keyof typeof DEFAULT_ROSTER_SETTINGS.labels; when: string }[] = [
  { key: "findChef", when: "Nog niemand voorgesteld" },
  { key: "awaitReply", when: "Voorgesteld, wacht op chef" },
  { key: "confirm", when: "Geaccepteerd, nog bevestigen" },
  { key: "topUp", when: "Deels bezet" },
  { key: "full", when: "Volledig bezet" },
  { key: "checkData", when: "Gegevens onvolledig" },
  { key: "done", when: "Afgerond" },
  { key: "cancelled", when: "Geannuleerd" },
];

export default async function InstellingenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requireRole("owner");
  const sp = await searchParams;
  const roster = await getRosterSettings(session.user.id);

  const [prefRow] = await db
    .select({ prefs: notificationPrefs.prefs })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, session.user.id))
    .limit(1);
  const notifPrefs = (prefRow?.prefs ?? {}) as Record<string, boolean>;

  async function saveRoster(formData: FormData) {
    "use server";
    const s = await requireRole("owner");
    const criticalHours = Math.max(1, Math.min(336, Number(formData.get("criticalHours")) || 24));
    const defaultView = formData.get("defaultView") === "month" ? "month" : "week";
    // Only store labels that differ from the default (so "reset" = clear the field).
    const labels: Partial<typeof DEFAULT_ROSTER_SETTINGS.labels> = {};
    for (const { key } of LABEL_FIELDS) {
      const v = String(formData.get(`label_${key}`) ?? "").trim();
      if (v && v !== DEFAULT_ROSTER_SETTINGS.labels[key]) labels[key] = v;
    }
    const patch: StoredRosterSettings = { criticalHours, defaultView, labels };
    await saveRosterSettings({ userId: s.user.id, patch });
    redirect("/admin/account/instellingen?ok=rooster");
  }

  async function saveMeldingen(formData: FormData) {
    "use server";
    const s = await requireRole("owner");
    for (const ev of ALL_EVENTS) {
      await setPref({ userId: s.user.id, eventKey: ev, enabled: formData.has(`ev_${ev}`) });
    }
    redirect("/admin/account/instellingen?ok=meldingen");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Mijn account</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Instellingen</h1>
      <p className="mt-2 text-sm text-ink-500">
        Stem de cockpit af op hoe jíj werkt. Deze instellingen gelden alleen voor jouw account.
      </p>

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok === "rooster" ? "Rooster-instellingen opgeslagen." : "Meldingen opgeslagen."}
        </p>
      ) : null}

      {/* ───── Rooster ───── */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Rooster</h2>
        <form action={saveRoster} className="mt-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Kritiek vanaf (uren vóór aanvang)</span>
              <input type="number" name="criticalHours" min={1} max={336} defaultValue={roster.criticalHours} className={inputCls} />
              <span className="mt-1 block text-[11px] text-ink-500">
                Onderbezette diensten binnen dit aantal uur kleuren <strong>Kritiek</strong> (rood).
              </span>
            </label>
            <label className="block">
              <span className={labelCls}>Standaard weergave</span>
              <select name="defaultView" defaultValue={roster.defaultView} className={inputCls}>
                <option value="week">Week</option>
                <option value="month">Maand</option>
              </select>
            </label>
          </div>

          <details className="rounded border border-ink-200 p-3">
            <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-ink-700">
              Geavanceerd · actie-teksten op de roosterkaart
            </summary>
            <p className="mt-2 text-[11px] text-ink-500">Leeg laten = standaardtekst gebruiken.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {LABEL_FIELDS.map(({ key, when }) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] text-ink-500">{when}</span>
                  <input type="text" name={`label_${key}`} defaultValue={roster.labels[key]} className={inputCls} />
                </label>
              ))}
            </div>
          </details>

          <button type="submit" className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
            Rooster opslaan
          </button>
        </form>
      </section>

      {/* ───── Meldingen ───── */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Meldingen</h2>
        <p className="mt-1 text-[11px] text-ink-500">Welke gebeurtenissen wil je ontvangen? (Standaard: alles aan.)</p>
        <form action={saveMeldingen} className="mt-3 space-y-2">
          {ALL_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center justify-between gap-3 rounded border border-ink-100 px-3 py-2 text-sm">
              <span className="text-ink-900">{EVENT_LABELS[ev] ?? ev}</span>
              <input type="checkbox" name={`ev_${ev}`} defaultChecked={notifPrefs[ev] !== false} className="h-4 w-4 accent-burgundy" />
            </label>
          ))}
          <button type="submit" className="mt-2 rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
            Meldingen opslaan
          </button>
        </form>
      </section>
    </div>
  );
}
