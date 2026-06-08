/**
 * /admin/business/instellingen — company-wide operational settings (PR-SET-1).
 *
 * Distinct from /admin/account/instellingen (per-user). These toggles apply to
 * the WHOLE business and are owner + super_admin only. V1: the hours-reminders
 * worker on/off switch (business_settings 'hours_reminders'); the Railway worker
 * reads the same flag via raw SQL. Room for future toggles (SLAs, default rates).
 *
 * Gate is requirePermission("settings", "write") for now → becomes requirePermission("settings",
 * "write") once the permission gates land (Workstream C, phase C3).
 */

import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { getDailyBriefingConfig, getFlag, setFlag, setSettingValue, SETTING_KEYS } from "@/lib/business-settings";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Bedrijfsinstellingen" };
export const dynamic = "force-dynamic";

export default async function BedrijfsinstellingenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requirePermission("settings", "write");
  const sp = await searchParams;
  const hoursRemindersOn = await getFlag(SETTING_KEYS.hoursReminders);
  const briefing = await getDailyBriefingConfig();

  async function saveHoursReminders(formData: FormData) {
    "use server";
    const s = await requirePermission("settings", "write");
    const enabled = formData.get("enabled") === "on";
    await setFlag(SETTING_KEYS.hoursReminders, enabled, s.user.id);
    await recordAuditFromRequest({
      userId: s.user.id,
      action: "business_settings.updated",
      resource: "business_settings",
      resourceId: SETTING_KEYS.hoursReminders,
      after: { key: SETTING_KEYS.hoursReminders, enabled },
    });
    redirect("/admin/business/instellingen?ok=hours_reminders");
  }

  async function saveDailyBriefing(formData: FormData) {
    "use server";
    const s = await requirePermission("settings", "write");
    const enabled = formData.get("enabled") === "on";
    const hourRaw = Number(formData.get("hour"));
    const hour = Number.isFinite(hourRaw) ? Math.min(23, Math.max(0, Math.trunc(hourRaw))) : 7;
    const channels = {
      app: formData.get("ch_app") === "on",
      email: formData.get("ch_email") === "on",
      whatsapp: formData.get("ch_whatsapp") === "on",
    };
    const current = await getDailyBriefingConfig();
    await setSettingValue(
      SETTING_KEYS.dailyBriefing,
      { enabled, hour, channels, whatsappTo: current.whatsappTo, lastSentDate: current.lastSentDate },
      s.user.id,
    );
    await recordAuditFromRequest({
      userId: s.user.id,
      action: "business_settings.updated",
      resource: "business_settings",
      resourceId: SETTING_KEYS.dailyBriefing,
      after: { key: SETTING_KEYS.dailyBriefing, enabled, hour, channels },
    });
    redirect("/admin/business/instellingen?ok=daily_briefing");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Bedrijf</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Bedrijfsinstellingen</h1>
      <p className="mt-2 text-sm text-ink-500">
        Deze instellingen gelden voor het hele bedrijf — niet alleen voor jouw account.
      </p>

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Instelling opgeslagen.
        </p>
      ) : null}

      {/* ───── Automatisering: uren-herinneringen ───── */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Automatisering</h2>
        <form action={saveHoursReminders} className="mt-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={hoursRemindersOn}
              className="mt-1 h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">Uren-herinneringen</span>
              <span className="mt-0.5 block text-sm text-ink-500">
                Stuurt automatisch herinneringen: een chef die zijn uren niet indient (na 24u en
                72u), een klant die de uren niet tekent (na 5 dagen), en een melding aan kantoor
                na 10 dagen.{" "}
                <strong className="text-ink-700">
                  Geldt voor het hele bedrijf en verstuurt e-mails naar klanten en chefs.
                </strong>
              </span>
              <span className="mt-1 block font-ui text-[11px] text-ink-400">
                Status nu: {hoursRemindersOn ? "aan" : "uit"} · draait dagelijks om 09:00.
              </span>
            </span>
          </label>
          <div className="mt-4">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
            >
              Opslaan
            </button>
          </div>
        </form>
      </section>

      {/* ───── Dagstart: proactieve ochtendbriefing ───── */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Dagstart</h2>
        <form action={saveDailyBriefing} className="mt-3 space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={briefing.enabled}
              className="mt-1 h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">Ochtendbriefing (dagstart)</span>
              <span className="mt-0.5 block text-sm text-ink-500">
                Elke ochtend een korte samenvatting: een terugblik op gisteren (gedraaide diensten,
                uren die nog niet rond zijn, nieuwe opmerkingen van hotels) en de vooruitblik van
                vandaag (geplande diensten, open plekken, uren die op je goedkeuring wachten,
                verlopende documenten).
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-end gap-6 pl-7">
            <label className="block">
              <span className="block text-sm font-medium text-ink-900">Tijdstip</span>
              <span className="mt-0.5 block text-xs text-ink-500">Nederlandse tijd</span>
              <select
                name="hour"
                defaultValue={String(briefing.hour)}
                className="mt-1 rounded border border-ink-300 bg-white px-3 py-1.5 text-sm focus:border-burgundy focus:ring-burgundy"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-ink-900">Kanalen</legend>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" name="ch_app" defaultChecked={briefing.channels.app} className="h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy" />
                Melding in dashboard
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" name="ch_email" defaultChecked={briefing.channels.email} className="h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy" />
                E-mail
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-400">
                <input type="checkbox" name="ch_whatsapp" defaultChecked={briefing.channels.whatsapp} className="h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy" />
                WhatsApp <span className="text-[11px]">(binnenkort — na goedkeuring template)</span>
              </label>
            </fieldset>
          </div>

          <p className="pl-7 font-ui text-[11px] text-ink-400">
            Status nu: {briefing.enabled ? `aan · ${String(briefing.hour).padStart(2, "0")}:00` : "uit"}. De
            briefing gaat alleen naar jou. Je kunt 'm ook altijd opvragen bij de assistent ("geef me mijn dagstart").
          </p>

          <div className="pl-7">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
            >
              Opslaan
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
