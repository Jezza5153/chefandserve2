/**
 * Owner agenda read-model (P2b/P2-finish) — projects data into one ordered event
 * stream for the day/week/month grid:
 *  - every shift in the window → a "shift" (bemand) or "open_shift" event;
 *  - every pending client change/cancel request → a "change_request" follow-up,
 *    anchored on its shift's date (client/owner view only);
 *  - every non-cancelled manual agenda_event in the window → a "manual" event
 *    (intake call, follow-up, onboarding task, contract start, internal reminder).
 * Optional client-lens / chef-lens scoping. Pure mappers are split out for smoke tests.
 */
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db/client";
import {
  agendaEvents,
  chefs,
  clients,
  clientShiftChangeRequests,
  placements,
  shifts,
  users,
} from "@/lib/db/schema";
import { amsterdamDayKey } from "@/lib/roster-format";
import { formatShiftRole } from "@/lib/labels";
import { agendaEventLabel, type ChecklistItem } from "@/lib/domain/agenda-events";

export type AgendaEventType = "shift" | "open_shift" | "change_request" | "manual";
export type AgendaTone = "neutral" | "good" | "warn";

/** Extra fields only present on manual (agenda_events-backed) entries. */
export type ManualAgendaMeta = {
  eventId: string;
  kind: string;
  kindLabel: string;
  status: "open" | "done" | "cancelled";
  notes: string | null;
  checklist: ChecklistItem[] | null;
  assignedToName: string | null;
  clientName: string | null;
  chefName: string | null;
};

export type AgendaEvent = {
  id: string;
  type: AgendaEventType;
  startsAt: Date;
  endsAt?: Date;
  /** Amsterdam day bucket (YYYY-MM-DD) for the grid. */
  dayKey: string;
  title: string;
  subtitle: string;
  /** Link target; "" for manual events (rendered inline, not a link). */
  href: string;
  tone: AgendaTone;
  clientId: string | null;
  /** Owning shift id; "" for manual events not tied to a shift. */
  shiftId: string;
  manual?: ManualAgendaMeta;
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

type ManualRow = {
  id: string;
  type: string;
  startsAt: Date;
  endsAt: Date | null;
  title: string;
  notes: string | null;
  status: string;
  checklist: ChecklistItem[] | null;
  clientId: string | null;
  clientName: string | null;
  chefName: string | null;
  assignedToName: string | null;
};

/** PURE: one manual agenda_event → an agenda event (tone reflects done / overdue-open). */
export function manualEventToAgendaEvent(r: ManualRow, now: Date): AgendaEvent {
  const done = r.status === "done";
  const overdue = !done && new Date(r.startsAt).getTime() < now.getTime();
  const checked = r.checklist ? r.checklist.filter((c) => c.done).length : 0;
  const total = r.checklist?.length ?? 0;
  const bits: string[] = [];
  if (total > 0) bits.push(checked + "/" + total + " afgevinkt");
  if (r.assignedToName) bits.push(r.assignedToName);
  else if (r.clientName) bits.push(r.clientName);
  else if (r.chefName) bits.push(r.chefName);
  if (done) bits.push("afgerond");
  else if (overdue) bits.push("over tijd");
  return {
    id: "agenda-" + r.id,
    type: "manual",
    startsAt: new Date(r.startsAt),
    endsAt: r.endsAt ? new Date(r.endsAt) : undefined,
    dayKey: amsterdamDayKey(r.startsAt),
    title: r.title,
    subtitle: bits.length > 0 ? bits.join(" · ") : agendaEventLabel(r.type),
    href: "",
    tone: done ? "good" : overdue ? "warn" : "neutral",
    clientId: r.clientId,
    shiftId: "",
    manual: {
      eventId: r.id,
      kind: r.type,
      kindLabel: agendaEventLabel(r.type),
      status: done ? "done" : "open",
      notes: r.notes,
      checklist: r.checklist,
      assignedToName: r.assignedToName,
      clientName: r.clientName,
      chefName: r.chefName,
    },
  };
}

/**
 * Build the ordered agenda for a window; optionally scoped to one client (client-lens)
 * or one chef (chef-lens). Chef-lens restricts shifts to those the chef is placed on and
 * drops client change-requests (they're client-side follow-ups).
 */
export async function getAgendaEvents(opts: {
  from: Date;
  to: Date;
  clientId?: string;
  chefId?: string;
}): Promise<AgendaEvent[]> {
  const now = new Date();

  // Chef-lens: restrict shifts to ones this chef has a placement on.
  let chefShiftIds: string[] | null = null;
  if (opts.chefId) {
    const pl = await db
      .selectDistinct({ shiftId: placements.shiftId })
      .from(placements)
      .where(eq(placements.chefId, opts.chefId));
    chefShiftIds = pl.map((p) => p.shiftId);
  }

  const shiftFilters = [gte(shifts.startsAt, opts.from), lt(shifts.startsAt, opts.to)];
  if (opts.clientId) shiftFilters.push(eq(shifts.clientId, opts.clientId));
  if (chefShiftIds) {
    if (chefShiftIds.length === 0) shiftFilters.push(sql`false`);
    else shiftFilters.push(inArray(shifts.id, chefShiftIds));
  }

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
    .where(and(...shiftFilters));

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
  // (Skipped under chef-lens — these are client-side follow-ups.)
  if (!opts.chefId) {
    const crFilters = [
      eq(clientShiftChangeRequests.status, "pending"),
      gte(shifts.startsAt, opts.from),
      lt(shifts.startsAt, opts.to),
    ];
    if (opts.clientId) crFilters.push(eq(clientShiftChangeRequests.clientId, opts.clientId));
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
      .where(and(...crFilters));
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
  }

  // Manual one-off events (intake calls, follow-ups, …). Cancelled are hidden.
  const assignee = alias(users, "agenda_assignee");
  const meFilters = [
    gte(agendaEvents.startsAt, opts.from),
    lt(agendaEvents.startsAt, opts.to),
    ne(agendaEvents.status, "cancelled"),
  ];
  if (opts.clientId) meFilters.push(eq(agendaEvents.linkedClientId, opts.clientId));
  if (opts.chefId) meFilters.push(eq(agendaEvents.linkedChefId, opts.chefId));
  const meRows = await db
    .select({
      id: agendaEvents.id,
      type: agendaEvents.type,
      startsAt: agendaEvents.startsAt,
      endsAt: agendaEvents.endsAt,
      title: agendaEvents.title,
      notes: agendaEvents.notes,
      status: agendaEvents.status,
      checklist: agendaEvents.checklist,
      clientId: agendaEvents.linkedClientId,
      clientName: clients.companyName,
      chefName: chefs.fullName,
      assignedToName: assignee.name,
    })
    .from(agendaEvents)
    .leftJoin(clients, eq(clients.id, agendaEvents.linkedClientId))
    .leftJoin(chefs, eq(chefs.id, agendaEvents.linkedChefId))
    .leftJoin(assignee, eq(assignee.id, agendaEvents.assignedTo))
    .where(and(...meFilters));
  for (const m of meRows) {
    events.push(
      manualEventToAgendaEvent(
        {
          id: m.id,
          type: m.type,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          title: m.title,
          notes: m.notes,
          status: m.status,
          checklist: m.checklist,
          clientId: m.clientId,
          clientName: m.clientName,
          chefName: m.chefName,
          assignedToName: m.assignedToName,
        },
        now,
      ),
    );
  }

  return events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
