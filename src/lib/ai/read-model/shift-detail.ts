/**
 * Shift detail read-model — one shift's full operational picture for the owner assistant:
 * the dienst facts, who's on it (placements + their status), the bezetting (filled/headcount),
 * and the hours status per placement. Read-only.
 *
 * All statuses come out as DUTCH LABELS (never the raw enum — the #91 lesson): the assistant
 * has the right words and can't leak `confirmed` / `client_signed` into an answer.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placementComments, placements, shiftHours, shifts } from "@/lib/db/schema";
import { humanStatus } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";

const SHIFT_STATUS_NL: Record<string, string> = {
  request: "aanvraag", open: "open", filled: "ingevuld", completed: "afgerond", cancelled: "geannuleerd",
};
const PLACEMENT_STATUS_NL: Record<string, string> = {
  proposed: "voorgesteld", accepted: "geaccepteerd", rejected: "afgewezen", confirmed: "bevestigd",
  cancelled: "geannuleerd", no_show: "no-show", completed: "afgerond", draft: "concept",
};
const FILLED = new Set(["accepted", "confirmed", "completed"]);

const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });

export async function shiftDetailForAi(shiftId: string) {
  const [shift] = await db
    .select({
      status: shifts.status,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      role: shifts.roleNeeded,
      headcount: shifts.headcount,
      whenDescription: shifts.whenDescription,
      notes: shifts.notes,
      clientName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift) return null;

  const [rows, hoursRows, commentCount] = await Promise.all([
    db
      .select({ status: placements.status, chef: chefs.fullName, placementId: placements.id })
      .from(placements)
      .innerJoin(chefs, eq(chefs.id, placements.chefId))
      .where(eq(placements.shiftId, shiftId)),
    db
      .select({ placementId: shiftHours.placementId, status: shiftHours.status })
      .from(shiftHours)
      .where(eq(shiftHours.shiftId, shiftId)),
    db
      .select({ id: placementComments.id })
      .from(placementComments)
      .innerJoin(placements, eq(placements.id, placementComments.placementId))
      .where(and(eq(placements.shiftId, shiftId)))
      .orderBy(desc(placementComments.createdAt)),
  ]);

  const hoursByPlacement = new Map(hoursRows.map((h) => [h.placementId, h.status]));
  const filled = rows.filter((r) => FILLED.has(r.status)).length;

  const team = rows.map((r) => {
    const hoursStatus = hoursByPlacement.get(r.placementId);
    return {
      chef: r.chef,
      status: PLACEMENT_STATUS_NL[r.status] ?? r.status,
      uren: hoursStatus ? humanStatus(hoursStatus) : null,
    };
  });

  return {
    klant: shift.clientName ?? "—",
    wanneer: `${dayNl(shift.startsAt)} ${hhmm(shift.startsAt)}–${hhmm(shift.endsAt)}`,
    rol: formatChefRole(shift.role ?? null),
    status: SHIFT_STATUS_NL[shift.status] ?? shift.status,
    bezetting: `${filled}/${shift.headcount}`,
    open: Math.max(0, shift.headcount - filled),
    omschrijving: [shift.whenDescription, shift.notes].filter((x) => x && x.trim()).join(" · ") || null,
    team,
    opmerkingen: commentCount.length,
  };
}
