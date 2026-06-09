/**
 * Klant shift change/cancel request queue — the owner's approval inbox for converted shifts.
 * A hotel asking to change or cancel a confirmed dienst lands here as a REQUEST (the owner
 * decides; never instant). Read-only; returns the requestId so the decide tool can act on it.
 * Soonest-shift-first (urgency). Owner-gated.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, clientShiftChangeRequests, shifts } from "@/lib/db/schema";
import { formatChefRole } from "@/lib/labels";

const KIND_NL: Record<string, string> = { change: "wijziging", cancel: "annulering" };
const STATUS_NL: Record<string, string> = { pending: "open", in_progress: "in behandeling", approved: "goedgekeurd", rejected: "afgewezen" };
const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const dateNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });

export async function pendingShiftChangeRequestsForAi(limit: number) {
  const rows = await db
    .select({
      id: clientShiftChangeRequests.id,
      kind: clientShiftChangeRequests.kind,
      reason: clientShiftChangeRequests.reason,
      status: clientShiftChangeRequests.status,
      createdAt: clientShiftChangeRequests.createdAt,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      role: shifts.roleNeeded,
      client: clients.companyName,
    })
    .from(clientShiftChangeRequests)
    .innerJoin(shifts, eq(shifts.id, clientShiftChangeRequests.shiftId))
    .leftJoin(clients, eq(clients.id, clientShiftChangeRequests.clientId))
    .where(inArray(clientShiftChangeRequests.status, ["pending", "in_progress"]))
    .orderBy(asc(shifts.startsAt))
    .limit(limit);

  return rows.map((r) => ({
    requestId: r.id,
    soort: KIND_NL[r.kind] ?? r.kind,
    status: STATUS_NL[r.status] ?? r.status,
    klant: r.client ?? "—",
    dienst: `${dayNl(r.shiftStart)} ${hhmm(r.shiftStart)}–${hhmm(r.shiftEnd)} (${formatChefRole(r.role ?? null)})`,
    reden: r.reason,
    aangevraagd: dateNl(r.createdAt),
  }));
}
