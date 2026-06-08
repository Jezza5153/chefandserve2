/**
 * Klant self-service read-model — the data behind the KLANT portal assistant. EVERY function
 * takes a `clientId` resolved from the session (resolveClientActor → subject.entityId) and
 * queries ONLY that klant's rows. Mirrors the /client dashboard; humanised for the brain.
 */
import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clientSubmissions, placements, ratings, shiftHours, shiftTemplates, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { formatPattern } from "@/lib/shift-template-format";

const dt = (d: Date | string) =>
  new Date(d).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_NL: Record<string, string> = {
  proposed: "wacht op chef",
  accepted: "chef komt",
  confirmed: "bevestigd",
  completed: "afgerond",
  cancelled: "geannuleerd",
  rejected: "afgewezen",
  no_show: "no-show",
};

/** This-week + upcoming confirmed/accepted shifts, plus headline counts. */
export async function clientMyShifts(clientId: string) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const week = await db
    .select({ p: placements, s: shifts, chef: chefs.fullName })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(and(eq(shifts.clientId, clientId), inArray(placements.status, ["accepted", "confirmed"]), gte(shifts.startsAt, startOfToday), lte(shifts.startsAt, endOfWeek)))
    .orderBy(shifts.startsAt)
    .limit(20);

  const [upcoming] = await db
    .select({ n: count() })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(and(eq(shifts.clientId, clientId), eq(placements.status, "confirmed"), gte(shifts.startsAt, now)));

  return {
    thisWeek: week.map((r) => ({ chef: r.chef, role: formatShiftRole(r.s.roleNeeded), when: dt(r.s.startsAt), status: STATUS_NL[r.p.status] ?? r.p.status })),
    upcomingConfirmed: Number(upcoming?.n ?? 0),
  };
}

/** Hours awaiting this klant's signature + 30-day spend (approved/exported). */
export async function clientMyHours(clientId: string) {
  const toSign = await db
    .select({ h: shiftHours, chef: chefs.fullName, when: shifts.startsAt })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(and(eq(shiftHours.clientId, clientId), eq(shiftHours.status, "submitted")))
    .orderBy(shifts.startsAt);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [spendRow] = await db
    .select({ raw: sql<string>`coalesce(sum(${shiftHours.workedMinutes}::bigint * ${shiftHours.clientRateCents}), 0)` })
    .from(shiftHours)
    .where(and(eq(shiftHours.clientId, clientId), inArray(shiftHours.status, ["admin_approved", "exported"]), gte(shiftHours.adminApprovedAt, thirtyDaysAgo)));
  const spendEur = Number(spendRow?.raw ?? 0) / 6000;

  return {
    toSign: toSign.map((r) => ({ chef: r.chef, when: dt(r.when) })),
    spend30dEur: spendEur > 0 ? `€ ${spendEur.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}` : "€ 0",
  };
}

/** Active recurring shift templates ("vaste diensten") for this klant. */
export async function clientMyTemplates(clientId: string) {
  const rows = await db
    .select({
      role: shiftTemplates.roleNeeded,
      headcount: shiftTemplates.headcount,
      dayOfWeek: shiftTemplates.dayOfWeek,
      startsAtTime: shiftTemplates.startsAtTime,
      endsAtTime: shiftTemplates.endsAtTime,
      endsNextDay: shiftTemplates.endsNextDay,
    })
    .from(shiftTemplates)
    .where(and(eq(shiftTemplates.clientId, clientId), eq(shiftTemplates.active, true)));

  return {
    templates: rows.map((r) => ({
      role: formatShiftRole(r.role),
      headcount: r.headcount,
      pattern: formatPattern({
        dayOfWeek: r.dayOfWeek,
        startsAtTime: r.startsAtTime,
        endsAtTime: r.endsAtTime,
        endsNextDay: r.endsNextDay,
      }),
    })),
  };
}

/** Open requests awaiting planning + chefs awaiting this klant's feedback. */
export async function clientMyRequests(clientId: string) {
  const pending = await db
    .select({ id: clientSubmissions.id, role: clientSubmissions.roleRequested, date: clientSubmissions.dateNeeded })
    .from(clientSubmissions)
    .where(and(eq(clientSubmissions.clientId, clientId), eq(clientSubmissions.status, "triaged")))
    .orderBy(desc(clientSubmissions.createdAt))
    .limit(10);

  const feedback = await db
    .select({ shiftId: shifts.id, chef: chefs.fullName, when: shifts.startsAt })
    .from(shiftHours)
    .innerJoin(placements, eq(placements.id, shiftHours.placementId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .leftJoin(ratings, eq(ratings.placementId, placements.id))
    .where(and(eq(shiftHours.clientId, clientId), eq(shiftHours.status, "admin_approved"), isNull(ratings.id)))
    .orderBy(desc(shifts.startsAt))
    .limit(5);

  return {
    openRequests: pending.map((r) => ({ role: r.role ?? "Personeel-aanvraag", date: r.date ?? null })),
    awaitingFeedback: feedback.map((r) => ({ chef: r.chef, when: dt(r.when) })),
  };
}
