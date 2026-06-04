/**
 * planner-intel — PLANNER-1. Thin composition for the planner cockpit (/admin/planning).
 * No new urgency math — direct queries for the planner's day-to-day queues (intake,
 * accepted-not-confirmed, open slots in the next 48h / 7d) + matching.findMatchesForShift
 * for the single most-urgent open shift. Deterministic; counts + the live roster only.
 */
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefSubmissions, clientSubmissions, clients, placements, shifts } from "@/lib/db/schema";
import { findMatchesForShift, type MatchResult } from "@/lib/domain/matching";

export type UrgentShift = {
  id: string;
  clientName: string | null;
  startsAt: Date;
  roleNeeded: string;
  headcount: number;
  confirmed: number;
  open: number;
  city: string | null;
};

export type PlannerCockpit = {
  intake: { chefs: number; clients: number; total: number };
  acceptedUnconfirmed: number;
  open48h: UrgentShift[];
  open48hSlots: number;
  open7dCount: number;
  topMatch: { shift: UrgentShift; matches: MatchResult[] } | null;
};

export async function getPlannerCockpit(now: Date = new Date()): Promise<PlannerCockpit> {
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
  const in7d = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const confirmedExpr = sql<number>`(select count(*) from placements p where p.shift_id = ${shifts.id} and p.status in ('confirmed','completed'))::int`;

  const [[chefIntake], [clientIntake], [accepted], rows, [open7d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(chefSubmissions).where(eq(chefSubmissions.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(clientSubmissions).where(eq(clientSubmissions.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(placements).where(eq(placements.status, "accepted")),
    db
      .select({
        id: shifts.id,
        clientName: clients.companyName,
        startsAt: shifts.startsAt,
        roleNeeded: shifts.roleNeeded,
        headcount: shifts.headcount,
        city: shifts.city,
        confirmed: confirmedExpr,
      })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(
        and(
          gt(shifts.startsAt, now),
          lte(shifts.startsAt, in48h),
          sql`${shifts.status} not in ('cancelled','completed')`,
        ),
      )
      .orderBy(asc(shifts.startsAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(shifts)
      .where(
        and(
          gt(shifts.startsAt, now),
          lte(shifts.startsAt, in7d),
          sql`${shifts.status} not in ('cancelled','completed')`,
          sql`${shifts.headcount} > (select count(*) from placements p where p.shift_id = ${shifts.id} and p.status in ('confirmed','completed'))`,
        ),
      ),
  ]);

  const open48h: UrgentShift[] = rows
    .map((r) => ({
      id: r.id,
      clientName: r.clientName,
      startsAt: r.startsAt,
      roleNeeded: r.roleNeeded,
      headcount: r.headcount,
      confirmed: r.confirmed,
      open: Math.max(0, r.headcount - r.confirmed),
      city: r.city,
    }))
    .filter((s) => s.open > 0);

  const open48hSlots = open48h.reduce((a, s) => a + s.open, 0);

  // Suggested matches for the single most-urgent open shift (bounded — never a fan-out).
  let topMatch: PlannerCockpit["topMatch"] = null;
  if (open48h.length > 0) {
    const shift = open48h[0];
    const matches = await findMatchesForShift(shift.id, { limit: 3 });
    topMatch = { shift, matches };
  }

  return {
    intake: {
      chefs: chefIntake?.n ?? 0,
      clients: clientIntake?.n ?? 0,
      total: (chefIntake?.n ?? 0) + (clientIntake?.n ?? 0),
    },
    acceptedUnconfirmed: accepted?.n ?? 0,
    open48h,
    open48hSlots,
    open7dCount: open7d?.n ?? 0,
    topMatch,
  };
}
