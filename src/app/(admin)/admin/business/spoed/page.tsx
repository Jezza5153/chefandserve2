/**
 * SPOED quick-create — the owner-initiated panic entry (DASH-PANIC).
 *
 * The new-need variant of the 09:40 call: a klant needs someone TODAY and there is
 * no shift row yet. The full "Nieuwe shift" form is 15+ fields tuned for planned
 * work; in a panic Maarten needs four: wie, wat, wanneer, hoe laat. Everything else
 * can be edited later on the shift page.
 *
 * Creates the shift with isEmergency=true (eligible for emergency claim when
 * EMERGENCY_CLAIM_ENABLED) and lands DIRECTLY in the dashboard fill drawer —
 * ranked matches, one-click Stel voor, WhatsApp — instead of the shift page.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { createShift, SHIFT_ROLE_VALUES, type ShiftRole } from "@/lib/domain/shifts";
import { formatChefRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";
import { fieldClass } from "@/components/forms/Fields";
import { amsterdamDayKey, amsterdamMidnightUtc } from "@/lib/roster-format";

export const metadata = { title: "Spoed" };
export const dynamic = "force-dynamic";

export default async function SpoedPage() {
  await requirePermission("shifts", "write");

  const clientList = await db
    .select({ id: clients.id, companyName: clients.companyName, city: clients.city })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")))
    .orderBy(clients.companyName);

  const todayKey = amsterdamDayKey(new Date());

  async function createSpoed(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const clientId = String(formData.get("clientId") ?? "").trim();
    const roleNeeded = String(formData.get("roleNeeded") ?? "") as ShiftRole;
    const date = String(formData.get("date") ?? "").trim();
    const startTime = String(formData.get("startTime") ?? "").trim();
    const endTime = String(formData.get("endTime") ?? "").trim();

    if (!clientId || !roleNeeded || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      redirect("/admin/business/spoed?err=1");
    }
    // Amsterdam wall-clock → UTC instant, DST-correct: anchor on the existing
    // amsterdamMidnightUtc helper and add the wall-clock offset. (A hardcoded
    // +02:00 would be wrong from late October to late March. Only a shift that
    // straddles the 02:00 DST switch itself — twice a year — can be 1h off.)
    const wall = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h! * 3600e3 + m! * 60e3;
    };
    const midnight = amsterdamMidnightUtc(date).getTime();
    const startsAt = new Date(midnight + wall(startTime));
    // An end before the start means "past midnight" → roll to the next day.
    let endsAt = new Date(midnight + wall(endTime));
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600e3);

    const client = clientList.find((c) => c.id === clientId);
    const result = await createShift({
      clientId,
      startsAt,
      endsAt,
      roleNeeded,
      headcount: 1,
      city: client?.city ?? null,
      isEmergency: true,
      createdBy: session.user.id,
    });
    if (!result.ok) redirect("/admin/business/spoed?err=1");

    // Straight into the panic toolkit — not the shift page.
    redirect(`/admin/business?drawer=open-shift&shiftId=${result.shiftId}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/business" className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-serif text-3xl text-ink-900">
        <span className="mr-2 rounded bg-red-700 px-2 py-0.5 font-ui text-sm font-bold uppercase tracking-[0.1em] text-white">Spoed</span>
        Nu iemand nodig
      </h1>
      <p className="mt-2 text-sm text-ink-700">
        Vier velden, meer niet. Na aanmaken sta je direct in de match-lade met de beste
        chefs. Tarieven en details kun je daarna op de dienst zetten.
      </p>

      {clientList.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Er zijn nog geen actieve klanten.
        </div>
      ) : (
        <form action={createSpoed} className="mt-6 grid gap-4 rounded-xl border border-ink-200 bg-white p-6">
          <label className="block">
            <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">Voor wie</span>
            <select name="clientId" required className={`${fieldClass} mt-1`} defaultValue="">
              <option value="" disabled>Kies klant…</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}{c.city ? ` — ${c.city}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">Wat</span>
            <select name="roleNeeded" required defaultValue="sous_chef" className={`${fieldClass} mt-1`}>
              {SHIFT_ROLE_VALUES.map((r) => (
                <option key={r} value={r}>{formatChefRole(r)}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">Wanneer</span>
              <input type="date" name="date" required defaultValue={todayKey} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block">
              <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">Van</span>
              <input type="time" name="startTime" required defaultValue="16:00" className={`${fieldClass} mt-1`} />
            </label>
            <label className="block">
              <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">Tot</span>
              <input type="time" name="endTime" required defaultValue="23:00" className={`${fieldClass} mt-1`} />
            </label>
          </div>
          <button
            type="submit"
            className="mt-1 rounded-lg bg-red-700 px-4 py-3 font-ui text-[12px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-red-800"
          >
            Maak spoeddienst → zoek chefs
          </button>
          <p className="text-center text-[11px] text-ink-500">
            Eindtijd vóór de starttijd? Dan rekenen we tot ná middernacht.
          </p>
        </form>
      )}
    </div>
  );
}
