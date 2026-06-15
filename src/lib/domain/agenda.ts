/**
 * Owner agenda read-model (P2b) — projects EXISTING data into one ordered event
 * stream for the day/week/month grid. Derived only (no agenda_events table yet):
 *  - every shift in the window → a "shift" (bemand) or "open_shift" event;
 *  - every pending client change/cancel request → a "change_request" follow-up,
 *    anchored on its shift's date.
 * The manual one-off events (intake calls, ad-hoc reminders) land with the
 * agenda_events table in a later slice. Pure mapping is split out for smoke tests.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, clientShiftChangeRequests, placements, shifts } from "@/lib/db/schema";
import { amsterdamDayKey } from "@/lib/roster-format";
import { formatShiftRole } from "@/lib/labels";

export type AgendaEventType = "shift" | "open_shift" | "change_request";
export type AgendaTone = "neutral" | "good" | "warn";

export type AgendaEvent = {
  id: string;
  type: AgendaEventType;
  startsAt: Date;
  endsAt?: Date;
  /** Amsterdam day bucket (YYYY-MM-DD) for the grid. */
  dayKey: string;
  title: string;
  subtitle: string;
  href: string;
  tone: AgendaTone;
  clientId: string | null;
  shiftId: string;
};

const FILLED = ["confirmed", "accepted"] as const;

type ShiftRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  roleNeeded: string;
  headcount: number;
  status: string;
  city: string | null;
  clientId: string | null;
  companyName: string | null;
};

/** PURE: one shift → one agenda event (open shifts deep-link into the fill drawer). */
export function shiftToAgendaEvent(r: ShiftRow, filledRaw: number): AgendaEvent {
  const filled = Math.min(filledRaw, r.headcount);
  const open = Math.max(r.headcount - filled, 0);
  const company = r.companyName ?? "Onbekende klant";
  const isOpen = r.status !== "cancelled" && open > 0;
  const cityTail = r.city ? " - " + r.city : "";
  return {
    id: "shift-" + r.id,
    type: isOpen ? "open_shift" : "shift",
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
    dayKey: amsterdamDayKey(r.startsAt),
    title: formatShiftRole(r.roleNeeded) + " - " + company,
    subtitle:
      r.status === "cancelled"
        ? "Geannuleerd"
        : filled + "/" + r.headcount + " bemand" + cityTail,
    // Open shifts open the dashboard's "Vul deze dienst" drawer; filled go to detail.
    href: isOpen
      ? "/admin/business?drawer=open-shift&shiftId=" + r.id
      : "/admin/business/shifts/" + r.id,
    tone: isOpen ? "warn" : "neutral",
    clientId: r.clientId,
    shiftId: r.id,
  };
}

/** PURE: a pending change/cancel request → a follow-up event anchored on the shift. */
export function changeRequestToAgendaEvent(args: {
  id: string;
  kind: string;
  shiftId: string;
  clientId: string | null;
  companyName: string | null;
  shiftStartsAt: Date;
}): AgendaEvent {
  const company = args.companyName ?? "Onbekende klant";
  const label = args.kind === "cancel" ? "Annuleringsverzoek" : "Wijzigingsverzoek";
  return {
    id: "changereq-" + args.id,
    type: "change_request",
    startsAt: new Date(args.shiftStartsAt),
    dayKey: amsterdamDayKey(args.shiftStartsAt),
    title: label + " - " + company,
    subtitle: "Wacht op je beoordeling",
    href: "/admin/business/shifts/" + args.shiftId,
    tone: "warn",
    clientId: args.clientId,
    shiftId: args.shiftId,
  };
}

/** Build the ordered agenda for a window; optionally scoped to one client (client-lens). */
export async function getAgendaEvents(opts: {
  from: Date;
  to: Date;
  clientId?: string;
}): Promise<AgendaEvent[]> {
  const shiftWhere = opts.clientId
    ? and(gte(shifts.startsAt, opts.from), lt(shifts.startsAt, opts.to), eq(shifts.clientId, opts.clientId))
    : and(gte(shifts.startsAt, opts.from), lt(shifts.startsAt, opts.to));

  const rows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      status: shifts.status,
      city: shifts.city,
      clientId: shifts.clientId,
      companyName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(shiftWhere);

  const ids = rows.map((r) => r.id);
  const countByShift = new Map<string, number>();
  if (ids.length > 0) {
    const counts = await db
      .select({ shiftId: placements.shiftId, n: sql<number>`count(*)::int` })
      .from(placements)
      .where(and(inArray(placements.shiftId, ids), inArray(placements.status, [...FILLED])))
      .groupBy(placements.shiftId);
    for (const c of counts) countByShift.set(c.shiftId, c.n);
  }

  const events: AgendaEvent[] = rows.map((r) => shiftToAgendaEvent(r as ShiftRow, countByShift.get(r.id) ?? 0));

  // Pending change/cancel requests on shifts in the window → follow-up events.
  const crWhere = opts.clientId
    ? and(eq(clientShiftChangeRequests.status, "pending"), eq(clientShiftChangeRequests.clientId, opts.clientId))
    : eq(clientShiftChangeRequests.status, "pending");
  const crRows = await db
    .select({
      id: clientShiftChangeRequests.id,
      kind: clientShiftChangeRequests.kind,
      shiftId: clientShiftChangeRequests.shiftId,
      clientId: clientShiftChangeRequests.clientId,
      companyName: clients.companyName,
      shiftStartsAt: shifts.startsAt,
    })
    .from(clientShiftChangeRequests)
    .innerJoin(shifts, eq(shifts.id, clientShiftChangeRequests.shiftId))
    .leftJoin(clients, eq(clients.id, clientShiftChangeRequests.clientId))
    .where(and(crWhere, gte(shifts.startsAt, opts.from), lt(shifts.startsAt, opts.to)));
  for (const cr of crRows) {
    events.push(
      changeRequestToAgendaEvent({
        id: cr.id,
        kind: cr.kind,
        shiftId: cr.shiftId,
        clientId: cr.clientId,
        companyName: cr.companyName,
        shiftStartsAt: cr.shiftStartsAt,
      }),
    );
  }

  return events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
