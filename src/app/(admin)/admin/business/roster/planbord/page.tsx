/**
 * /admin/business/roster/planbord — PLANBORD-1. The "maak het rooster" surface.
 *
 * Drag a chef from the rail onto a shift's open slot → a private CONCEPT (draft).
 * Concepts are invisible to chef + klant (and to shift-status) until "Publiceer
 * week" flips them → proposed and fires the proposal mails. Build-only: gated on
 * shifts:write — the same right the shift page + AI placement tools require.
 */
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs, clients, placements, shifts } from "@/lib/db/schema";
import { formatChefRole, formatSegment } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";
import { addDaysToKey, amsterdamDayKey, getAmsterdamWeekRange } from "@/lib/roster-format";

import { Planbord, type PlanbordChef, type PlanbordShift } from "./_components/Planbord";

export const metadata = { title: "Planbord", robots: { index: false } };
export const dynamic = "force-dynamic";

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PlanbordPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requirePermission("shifts", "write");
  const sp = await searchParams;
  const now = new Date();
  const todayKey = amsterdamDayKey(now);
  const anchor = sp.week && KEY_RE.test(sp.week) ? sp.week : todayKey;
  const week = getAmsterdamWeekRange(anchor);

  // 1. The week's shifts + klant.
  const shiftRows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      city: shifts.city,
      status: shifts.status,
      companyName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(and(gte(shifts.startsAt, week.startUtc), lt(shifts.startsAt, week.endUtc)))
    .orderBy(shifts.startsAt);

  const shiftIds = shiftRows.map((s) => s.id);

  // 2. Live placements (draft + pipeline) on those shifts, with chef names.
  const plRows = shiftIds.length
    ? await db
        .select({
          shiftId: placements.shiftId,
          placementId: placements.id,
          chefId: placements.chefId,
          chefName: chefs.fullName,
          status: placements.status,
          matchScore: placements.matchScore,
        })
        .from(placements)
        .innerJoin(chefs, eq(chefs.id, placements.chefId))
        .where(
          and(
            inArray(placements.shiftId, shiftIds),
            inArray(placements.status, ["draft", "proposed", "accepted", "confirmed"]),
          ),
        )
    : [];

  // Rejected placements re-open the slot silently — surface a count so the
  // planner knows a chef declined and the slot needs a new concept (D1).
  const rejectedRows = shiftIds.length
    ? await db
        .select({ shiftId: placements.shiftId })
        .from(placements)
        .where(and(inArray(placements.shiftId, shiftIds), eq(placements.status, "rejected")))
    : [];
  const rejectedByShift = new Map<string, number>();
  for (const r of rejectedRows) {
    rejectedByShift.set(r.shiftId, (rejectedByShift.get(r.shiftId) ?? 0) + 1);
  }

  const slotsByShift = new Map<string, PlanbordShift["slots"]>();
  for (const p of plRows) {
    const arr = slotsByShift.get(p.shiftId) ?? [];
    arr.push({ placementId: p.placementId, chefId: p.chefId, chefName: p.chefName, status: p.status, matchScore: p.matchScore });
    slotsByShift.set(p.shiftId, arr);
  }

  // 3. Group by Amsterdam day for the 7 columns.
  const byDay: Record<string, PlanbordShift[]> = {};
  for (const s of shiftRows) {
    const dayKey = amsterdamDayKey(s.startsAt);
    (byDay[dayKey] ??= []).push({
      id: s.id,
      companyName: s.companyName ?? "Onbekende klant",
      role: formatChefRole(s.roleNeeded),
      startsAt: s.startsAt instanceof Date ? s.startsAt.toISOString() : String(s.startsAt),
      endsAt: s.endsAt instanceof Date ? s.endsAt.toISOString() : String(s.endsAt),
      headcount: s.headcount,
      status: s.status,
      city: s.city,
      rejectedCount: rejectedByShift.get(s.id) ?? 0,
      slots: slotsByShift.get(s.id) ?? [],
    });
  }

  // 4. The chef pool rail — all active chefs.
  const chefRows = await db
    .select({
      id: chefs.id,
      fullName: chefs.fullName,
      vakniveau: chefs.vakniveau,
      segments: chefs.segments,
      city: chefs.city,
    })
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active")))
    .orderBy(chefs.fullName);

  const chefPool: PlanbordChef[] = chefRows.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    niveau: c.vakniveau ? formatChefRole(c.vakniveau) : null,
    skills: (c.segments ?? []).map(formatSegment),
    city: c.city,
  }));

  // Blocked days this week, per chef (so the "Per chef" lens shows real availability).
  const blockedRows = await db
    .select({ chefId: chefAvailability.chefId, date: chefAvailability.date })
    .from(chefAvailability)
    .where(
      and(
        gte(chefAvailability.date, new Date(`${week.startKey}T00:00:00Z`)),
        lt(chefAvailability.date, new Date(`${addDaysToKey(week.days[6], 1)}T00:00:00Z`)),
        eq(chefAvailability.available, false),
      ),
    );
  const blockedByChef: Record<string, string[]> = {};
  for (const r of blockedRows) {
    (blockedByChef[r.chefId] ??= []).push(r.date.toISOString().slice(0, 10));
  }

  const draftCount = plRows.filter((p) => p.status === "draft").length;
  const proposedCount = plRows.filter((p) => p.status === "proposed").length;
  const acceptedCount = plRows.filter((p) => p.status === "accepted").length;
  const confirmedCount = plRows.filter((p) => p.status === "confirmed").length;

  return (
    <Planbord
      weekDays={week.days}
      weekStartKey={week.startKey}
      todayKey={todayKey}
      prevWeek={addDaysToKey(week.startKey, -7)}
      nextWeek={addDaysToKey(week.startKey, 7)}
      byDay={byDay}
      chefPool={chefPool}
      blockedByChef={blockedByChef}
      draftCount={draftCount}
      proposedCount={proposedCount}
      acceptedCount={acceptedCount}
      confirmedCount={confirmedCount}
    />
  );
}
