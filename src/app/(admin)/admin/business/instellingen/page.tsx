/**
 * /admin/business/instellingen — company-wide operational settings (PR-SET-1).
 *
 * Distinct from /admin/account/instellingen (per-user). These toggles apply to
 * the WHOLE business and are owner + super_admin only. V1: the hours-reminders
 * worker on/off switch (business_settings 'hours_reminders'); the Railway worker
 * reads the same flag via raw SQL. Room for future toggles (SLAs, default rates).
 *
 * Gate is requireRole("owner") for now → becomes requirePermission("settings",
 * "write") once the permission gates land (Workstream C, phase C3).
 */

import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { getFlag, setFlag, SETTING_KEYS } from "@/lib/business-settings";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Bedrijfsinstellingen" };
export const dynamic = "force-dynamic";

export default async function BedrijfsinstellingenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;
  const hoursRemindersOn = await getFlag(SETTING_KEYS.hoursReminders);

  async function saveHoursReminders(formData: FormData) {
    "use server";
    const s = await requireRole("owner");
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
    </div>
  );
}
