/**
 * Roster read-model — the assistant's "staffing picture". It mirrors the cockpit page's
 * period→date-range + grouped shift query, then runs the SAME shared engine
 * (buildRosterView + rosterAiSummary from roster-intel.ts) so the AI's answer can never
 * disagree with the /admin/business/roster screen.
 *
 * The summary ENGINE is imported (one source of truth). Only the range+query is mirrored
 * here — keep it in sync with roster/page.tsx (~154-193) if that query ever changes. The
 * AI only needs week/month views (no day-board supply extras), so this is a subset of the
 * page's assembly.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, placements, shifts } from "@/lib/db/schema";
import {
  buildRosterView,
  rosterAiSummary,
  type RosterShiftRow,
  type RosterView,
} from "@/lib/domain/roster-intel";
import { getRosterSettings } from "@/lib/domain/user-settings";
import {
  addDaysToKey,
  amsterdamDayKey,
  getAmsterdamMonthGrid,
  getAmsterdamWeekRange,
} from "@/lib/roster-format";

export type RosterPeriod = "this_week" | "next_week" | "this_month";

export async function loadRosterAiSummary(args: {
  period: RosterPeriod;
  userId: string;
  now: Date;
}): Promise<{ text: string; facts: Record<string, unknown> }> {
  const todayKey = amsterdamDayKey(args.now);

  let view: RosterView;
  let dateKey: string;
  let startUtc: Date;
  let endUtc: Date;
  if (args.period === "this_month") {
    const month = getAmsterdamMonthGrid(todayKey);
    view = "month";
    dateKey = `${month.monthKey}-01`;
    startUtc = month.startUtc;
    endUtc = month.endUtc;
  } else {
    const anchor = args.period === "next_week" ? addDaysToKey(todayKey, 7) : todayKey;
    const week = getAmsterdamWeekRange(anchor);
    view = "week";
    dateKey = week.startKey;
    startUtc = week.startUtc;
    endUtc = week.endUtc;
  }

  // Mirror of roster/page.tsx's grouped shift query (period's shifts + pipeline counts).
  const rows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      location: shifts.location,
      city: shifts.city,
      status: shifts.status,
      clientId: shifts.clientId,
      companyName: clients.companyName,
      confirmedCount: sql<number>`count(*) filter (where ${placements.status} = 'confirmed')::int`,
      acceptedCount: sql<number>`count(*) filter (where ${placements.status} = 'accepted')::int`,
      proposedCount: sql<number>`count(*) filter (where ${placements.status} = 'proposed')::int`,
      earliestProposedAt: sql<string | null>`min(${placements.proposedAt}) filter (where ${placements.status} = 'proposed')`,
      draftCount: sql<number>`count(*) filter (where ${placements.status} = 'draft')::int`,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .leftJoin(placements, eq(placements.shiftId, shifts.id))
    .where(and(gte(shifts.startsAt, startUtc), lt(shifts.startsAt, endUtc)))
    .groupBy(shifts.id, clients.companyName)
    .orderBy(shifts.startsAt);

  const shiftRows: RosterShiftRow[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    roleNeeded: r.roleNeeded,
    headcount: r.headcount,
    status: r.status,
    location: r.location,
    city: r.city,
    clientId: r.clientId,
    companyName: r.companyName,
    confirmedCount: r.confirmedCount,
    acceptedCount: r.acceptedCount,
    proposedCount: r.proposedCount,
    earliestProposedAt: r.earliestProposedAt,
  }));

  const rs = await getRosterSettings(args.userId);
  const vm = buildRosterView({
    view,
    dateKey,
    rows: shiftRows,
    settings: { criticalHours: rs.criticalHours, labels: rs.labels },
    now: args.now,
  });
  const summary = rosterAiSummary(vm);

  // PR-PLANBORD-1: surface unpublished concepts so the assistant can say "staat
  // klaar, nog niet gepubliceerd" before the owner asks to publish.
  const draftsPending = rows.reduce((a, r) => a + (r.draftCount ?? 0), 0);
  return {
    text:
      draftsPending > 0
        ? `${summary.text} Let op: ${draftsPending} concept${draftsPending === 1 ? "" : "en"} staan klaar maar zijn nog niet gepubliceerd.`
        : summary.text,
    facts: { ...summary.facts, draftsPending },
  };
}
