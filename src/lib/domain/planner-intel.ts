/**
 * planner-intel — PLANNER-1. Thin composition for the planner cockpit (/admin/planning).
 * No new urgency math — direct queries for the planner's day-to-day queues (intake,
 * accepted-not-confirmed, open slots in the next 48h / 7d) + matching.findMatchesForShift
 * for the single most-urgent open shift. Deterministic; counts + the live roster only.
 */
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefs,
  chefSubmissions,
  clientShiftChangeRequests,
  clientSubmissions,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
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

/** A placement row in one of the planner's work-queues (confirm / chase). */
export type QueuedPlacement = {
  placementId: string;
  shiftId: string;
  chefName: string;
  clientName: string | null;
  startsAt: Date;
  roleNeeded: string;
  /** Hours since the proposal went out (chase-queue only). */
  ageHours?: number;
};

export type PendingChangeRequest = {
  id: string;
  shiftId: string;
  kind: string;
  clientName: string | null;
  createdAt: Date;
};

export type PlannerCockpit = {
  intake: { chefs: number; clients: number; total: number };
  acceptedUnconfirmed: number;
  /** Placements still 'proposed' — chefs who haven't said ja/nee yet (hesitation depth). */
  proposedPending: number;
  /** Work-queue: accepted placements awaiting the planner's confirm (inline action). */
  toConfirm: QueuedPlacement[];
  /** Work-queue: proposals the chef hasn't answered, oldest first (chase). */
  awaitingChef: QueuedPlacement[];
  /** Pending klant change/cancel requests — can invalidate a shift you're about to fill. */
  pendingChangeRequests: PendingChangeRequest[];
  open48h: UrgentShift[];
  open48hSlots: number;
  open7dCount: number;
  /** Match suggestions for the top N most-urgent open shifts (bounded fan-out). */
  topMatches: { shift: UrgentShift; matches: MatchResult[] }[];
};

export async function getPlannerCockpit(now: Date = new Date()): Promise<PlannerCockpit> {
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
  const in7d = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const confirmedExpr = sql<number>`(select count(*) from placements p where p.shift_id = ${shifts.id} and p.status in ('confirmed','completed'))::int`;

  // Shared shape for the two placement work-queues (confirm + chase).
  const queueSelect = {
    placementId: placements.id,
    shiftId: placements.shiftId,
    chefName: chefs.fullName,
    clientName: clients.companyName,
    startsAt: shifts.startsAt,
    roleNeeded: shifts.roleNeeded,
    proposedAt: placements.proposedAt,
  };

  const [[chefIntake], [clientIntake], [accepted], [proposed], toConfirmRows, awaitingRows, changeReqRows, rows, [open7d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(chefSubmissions).where(eq(chefSubmissions.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(clientSubmissions).where(eq(clientSubmissions.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(placements).where(eq(placements.status, "accepted")),
    db.select({ n: sql<number>`count(*)::int` }).from(placements).where(eq(placements.status, "proposed")),
    db
      .select(queueSelect)
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .innerJoin(chefs, eq(chefs.id, placements.chefId))
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(eq(placements.status, "accepted"), gt(shifts.startsAt, now)))
      .orderBy(asc(shifts.startsAt))
      .limit(8),
    db
      .select(queueSelect)
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .innerJoin(chefs, eq(chefs.id, placements.chefId))
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(eq(placements.status, "proposed"), gt(shifts.startsAt, now)))
      .orderBy(asc(placements.proposedAt))
      .limit(8),
    db
      .select({
        id: clientShiftChangeRequests.id,
        shiftId: clientShiftChangeRequests.shiftId,
        kind: clientShiftChangeRequests.kind,
        clientName: clients.companyName,
        createdAt: clientShiftChangeRequests.createdAt,
      })
      .from(clientShiftChangeRequests)
      .innerJoin(shifts, eq(shifts.id, clientShiftChangeRequests.shiftId))
      .leftJoin(clients, eq(clients.id, clientShiftChangeRequests.clientId))
      .where(
        and(
          inArray(clientShiftChangeRequests.status, ["pending", "in_progress"]),
          // Liveness: requests on past/cancelled shifts would otherwise nag forever AND starve
          // the oldest-first cap, hiding NEW actionable requests (review finding).
          gt(shifts.startsAt, now),
          sql`${shifts.status} not in ('cancelled','completed')`,
        ),
      )
      .orderBy(asc(clientShiftChangeRequests.createdAt))
      .limit(5),
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

  // Suggested matches for the top 3 most-urgent open shifts (bounded fan-out: 3 × 2 candidates).
  // Parallel — each findMatchesForShift is ~6 serial neon-http round-trips; sequential would
  // triple the latency of a page that AutoRefreshes every 60s (review finding).
  const topMatches: PlannerCockpit["topMatches"] = await Promise.all(
    open48h.slice(0, 3).map(async (shift) => ({
      shift,
      matches: await findMatchesForShift(shift.id, { limit: 2 }),
    })),
  );

  const toQueued = (r: (typeof toConfirmRows)[number], withAge = false): QueuedPlacement => ({
    placementId: r.placementId,
    shiftId: r.shiftId,
    chefName: r.chefName,
    clientName: r.clientName,
    startsAt: r.startsAt,
    roleNeeded: r.roleNeeded,
    ...(withAge && r.proposedAt
      ? { ageHours: Math.floor((now.getTime() - new Date(r.proposedAt).getTime()) / 3_600_000) }
      : {}),
  });

  return {
    intake: {
      chefs: chefIntake?.n ?? 0,
      clients: clientIntake?.n ?? 0,
      total: (chefIntake?.n ?? 0) + (clientIntake?.n ?? 0),
    },
    acceptedUnconfirmed: accepted?.n ?? 0,
    proposedPending: proposed?.n ?? 0,
    toConfirm: toConfirmRows.map((r) => toQueued(r)),
    awaitingChef: awaitingRows.map((r) => toQueued(r, true)),
    pendingChangeRequests: changeReqRows,
    open48h,
    open48hSlots,
    open7dCount: open7d?.n ?? 0,
    topMatches,
  };
}

/* ----- PLANNER-2: mini-reporting (deterministic, noise-guarded) ----------- */

function execRows<T>(r: unknown): T[] {
  return Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);
}

/** Self-contained noise guard (baseline 5) — no cross-module dep, so PLANNER-2 lands on main independent of the KPI branch. */
export type IntakeDelta = {
  mode: "arrow" | "plain" | "hidden";
  dir: "up" | "down" | "flat";
  diff: number;
  previous: number;
};
function intakeGuard(current: number, previous: number): IntakeDelta {
  const diff = current - previous;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const mode = previous >= 5 ? "arrow" : previous > 0 ? "plain" : "hidden";
  return { mode, dir, diff, previous };
}

export type PlannerReport = {
  intakeThis7d: number;
  intakePrev7d: number;
  intakeDelta: IntakeDelta; // this 7d vs prior 7d, noise-guarded (baseline 5)
  fillRate30d: number | null; // realized fill over the last 30 days
  fillFilled: number;
  fillSlots: number;
  medianResponseMin: number | null; // median chef response (proposal events) last 30d
};

export async function getPlannerReport(): Promise<PlannerReport> {
  const [intakeRes, fillRes, medRes] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS this,
        count(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')::int AS prev
      FROM (
        SELECT created_at FROM chef_submissions
        UNION ALL SELECT created_at FROM client_submissions
      ) s
      WHERE created_at >= now() - interval '14 days'
    `),
    db.execute(sql`
      SELECT coalesce(sum(headcount), 0)::int AS slots, coalesce(sum(filled), 0)::int AS filled FROM (
        SELECT s.headcount,
          least((SELECT count(*) FROM placements p WHERE p.shift_id = s.id AND p.status IN ('confirmed','completed')), s.headcount)::int AS filled
        FROM shifts s
        WHERE s.starts_at >= now() - interval '30 days' AND s.starts_at <= now()
      ) t
    `),
    db.execute(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY response_seconds) AS med
      FROM chef_events
      WHERE occurred_at >= now() - interval '30 days'
        AND event_type IN ('proposal_accepted','proposal_rejected')
        AND response_seconds IS NOT NULL
    `),
  ]);

  const intake = execRows<{ this: number; prev: number }>(intakeRes)[0] ?? { this: 0, prev: 0 };
  const fill = execRows<{ slots: number; filled: number }>(fillRes)[0] ?? { slots: 0, filled: 0 };
  const med = execRows<{ med: number | null }>(medRes)[0]?.med ?? null;
  const slots = Number(fill.slots);
  const filled = Number(fill.filled);
  const intakeThis7d = Number(intake.this);
  const intakePrev7d = Number(intake.prev);

  return {
    intakeThis7d,
    intakePrev7d,
    intakeDelta: intakeGuard(intakeThis7d, intakePrev7d),
    fillRate30d: slots > 0 ? filled / slots : null,
    fillFilled: filled,
    fillSlots: slots,
    medianResponseMin: med != null ? Math.round(Number(med) / 60) : null,
  };
}
