/**
 * GET /admin/business/calendar.ics?token=... (P2a, owner operations calendar).
 *
 * Public-by-token ICS feed of the operations calendar: every shift in a forward
 * window with its fill status, so the owner/planner can see staffing in their phone
 * agenda. Token-authed via users.calendarTokenSecret (rotate to revoke); the
 * token-user MUST be owner/super_admin. Middleware lets calendar.ics through before auth.
 */

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { agendaEvents, clients, placements, roles, shifts, userRoles, users } from "@/lib/db/schema";
import { buildIcs, icsEtag, parseCalendarToken } from "@/lib/calendar/ics";
import { agendaEventLabel } from "@/lib/domain/agenda-events";
import { formatShiftRole } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILLED = ["confirmed", "accepted"] as const;

type IcsStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

type ShiftRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  roleNeeded: string;
  headcount: number;
  location: string | null;
  city: string | null;
  status: string;
  companyName: string | null;
};

function toEvent(r: ShiftRow, filledRaw: number) {
  const filled = Math.min(filledRaw, r.headcount);
  const open = Math.max(r.headcount - filled, 0);
  const company = r.companyName ?? "Onbekende klant";
  const cityTail = r.city ? " - " + r.city : "";
  let status: IcsStatus = "CONFIRMED";
  let description = "Volledig bemand" + cityTail;
  if (r.status === "cancelled") {
    status = "CANCELLED";
    description = "Geannuleerd";
  } else if (open > 0) {
    status = "TENTATIVE";
    description = String(open) + " plek(ken) open" + cityTail;
  }
  return {
    uid: "shift-" + r.id + "@chefandserve",
    summary: formatShiftRole(r.roleNeeded) + " " + filled + "/" + r.headcount + " - " + company,
    description,
    location: r.location ?? undefined,
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
    status,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return new Response("Token required", { status: 401 });

  const userId = await parseCalendarToken({
    token,
    lookupSecret: async (uid) => {
      const [u] = await db
        .select({ secret: users.calendarTokenSecret })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);
      return u?.secret ?? null;
    },
  });
  if (!userId) return new Response("Invalid token", { status: 401 });

  const roleRows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const isOwner = roleRows.some((r) => r.key === "owner" || r.key === "super_admin");
  if (!isOwner) return new Response("Not authorised", { status: 403 });

  const from = new Date(Date.now() - 7 * 864e5);
  const to = new Date(Date.now() + 90 * 864e5);
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
      companyName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(and(gte(shifts.startsAt, from), lte(shifts.startsAt, to)));

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

  // Manual one-off events (intake calls, follow-ups, …) — owner-only feed, so the
  // owner's own titles are fine to surface. Free-text notes are deliberately NOT
  // included; description stays to the kind + linked client (AVG-conservative).
  const linkedClient = alias(clients, "linked_client");
  const meRows = await db
    .select({
      id: agendaEvents.id,
      type: agendaEvents.type,
      title: agendaEvents.title,
      startsAt: agendaEvents.startsAt,
      endsAt: agendaEvents.endsAt,
      status: agendaEvents.status,
      companyName: linkedClient.companyName,
    })
    .from(agendaEvents)
    .leftJoin(linkedClient, eq(linkedClient.id, agendaEvents.linkedClientId))
    .where(and(gte(agendaEvents.startsAt, from), lte(agendaEvents.startsAt, to), ne(agendaEvents.status, "cancelled")));

  const manualEvents = meRows.map((m) => {
    const start = new Date(m.startsAt);
    const end = m.endsAt ? new Date(m.endsAt) : new Date(start.getTime() + 30 * 60_000);
    const label = agendaEventLabel(m.type);
    return {
      uid: "agenda-" + m.id + "@chefandserve",
      summary: label + " - " + m.title,
      description: m.companyName ? "Klant: " + m.companyName : label,
      startsAt: start,
      endsAt: end,
      status: (m.status === "done" ? "CONFIRMED" : "TENTATIVE") as IcsStatus,
    };
  });

  const ics = buildIcs({
    calendarName: "Chef & Serve - Operations",
    events: [...rows.map((r) => toEvent(r as ShiftRow, countByShift.get(r.id) ?? 0)), ...manualEvents],
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=60",
      ETag: '"' + icsEtag(ics) + '"',
    },
  });
}
