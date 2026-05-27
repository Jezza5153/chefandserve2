/**
 * /chef/availability — chef sets which dates they're blocked.
 *
 * PR-F2. Replaces the stub. Uses existing chef_availability table that
 * smart-match already reads (src/lib/domain/matching.ts blockedSet).
 *
 * UX:
 *   - Default state: all dates are AVAILABLE (no rows = available).
 *   - Click a date → toggles BLOCKED (writes a row with available=false).
 *   - Shift-click two dates → blocks the whole range.
 *   - Past dates are read-only.
 *
 * Security:
 *   - Page only renders for kind=chef sessions (middleware enforces).
 *   - Server actions look up the chef via session.user.id → chefs.userId.
 *     The user CANNOT write to a different chefId — the lookup is the auth.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { auditLog, chefAvailability, chefs } from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";

import { AvailabilityCalendar } from "./_components/AvailabilityCalendar";

export const metadata = { title: "Beschikbaarheid" };
export const dynamic = "force-dynamic";

const WEEKS_AHEAD = 8;

/** Resolve the chef record bound to the current session. Throws on mismatch. */
async function requireChefSelf(): Promise<{ chefId: string }> {
  const session = await requireAuth("/chef/availability");
  const [chef] = await db
    .select({ id: chefs.id })
    .from(chefs)
    .where(eq(chefs.userId, session.user.id))
    .limit(1);
  if (!chef) {
    // User is kind=chef in session but no chef record — admin needs to link
    // them. Send them home.
    redirect("/chef");
  }
  return { chefId: chef.id };
}

function parseIsoDate(iso: string): Date {
  // Build a UTC midnight Date — chef_availability column is `date` mode.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date;
}

async function toggleDate(isoDate: string, blocked: boolean): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const date = parseIsoDate(isoDate);
  // Guard: past dates are read-only.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (date < today) return;

  if (blocked) {
    // Upsert a "blocked" row.
    await db
      .insert(chefAvailability)
      .values({ chefId, date, available: false })
      .onConflictDoUpdate({
        target: [chefAvailability.chefId, chefAvailability.date],
        set: { available: false },
      });
  } else {
    // Unblock = delete the row (no row = available, our default).
    await db
      .delete(chefAvailability)
      .where(
        and(eq(chefAvailability.chefId, chefId), eq(chefAvailability.date, date)),
      );
  }

  await db.insert(auditLog).values({
    action: "chef.availability_updated",
    resource: "chef_availability",
    resourceId: chefId,
    after: { date: isoDate, blocked },
  });
}

async function setRange(
  startIso: string,
  endIso: string,
  blocked: boolean,
): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (end < start) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const effectiveStart = start < today ? today : start;
  if (effectiveStart > end) return;

  // Build list of dates in range
  const dates: Date[] = [];
  const cursor = new Date(effectiveStart);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length === 0) return;

  if (blocked) {
    // Bulk upsert
    await db
      .insert(chefAvailability)
      .values(
        dates.map((d) => ({ chefId, date: d, available: false })),
      )
      .onConflictDoUpdate({
        target: [chefAvailability.chefId, chefAvailability.date],
        set: { available: false },
      });
  } else {
    // Unblock the range
    await db
      .delete(chefAvailability)
      .where(
        and(
          eq(chefAvailability.chefId, chefId),
          gte(chefAvailability.date, effectiveStart),
          lte(chefAvailability.date, end),
        ),
      );
  }

  await db.insert(auditLog).values({
    action: "chef.availability_range_updated",
    resource: "chef_availability",
    resourceId: chefId,
    after: {
      startIso,
      endIso,
      blocked,
      affectedDates: dates.length,
    },
  });
}

export default async function ChefAvailabilityPage() {
  const { chefId } = await requireChefSelf();

  // Load blocked rows for the next 8 weeks (anything else = available).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + WEEKS_AHEAD * 7);

  const rows = await db
    .select({ date: chefAvailability.date, available: chefAvailability.available })
    .from(chefAvailability)
    .where(
      and(
        eq(chefAvailability.chefId, chefId),
        gte(chefAvailability.date, today),
        lte(chefAvailability.date, horizon),
        eq(chefAvailability.available, false),
      ),
    );

  const blockedDates = rows.map((r) => {
    // r.date is a Date (UTC midnight per schema mode: "date"). Format as ISO.
    const d = new Date(r.date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  });

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Beschikbaarheid
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Mijn agenda
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Standaard ben je elke dag beschikbaar. Blokkeer dagen voor vakantie of
        andere afspraken — wij stellen je dan niet voor op shifts op die dagen.
        Veranderingen zijn meteen actief.
      </p>

      <div className="mt-8">
        <AvailabilityCalendar
          weeks={WEEKS_AHEAD}
          initialBlockedDates={blockedDates}
          toggleDate={toggleDate}
          setRange={setRange}
        />
      </div>
    </div>
  );
}
