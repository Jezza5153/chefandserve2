/**
 * Klant shift-detail read-model — one shift's picture for the KLANT assistant ("wie staat er
 * woensdag op de dienst?"). Mirrors the owner shiftDetailForAi but is OWN-DATA-SCOPED and
 * AVG-tighter:
 *   - WHERE shift.clientId = the asking klant → returns null for any other shift (no IDOR).
 *   - NEVER exposes the internal shift.notes (owner-only) — only the klant-facing whenDescription.
 *   - Counts ONLY client_visible comments (the hard rule: klant reads go through the
 *     client_visible lens, never internal/chef_visible).
 * All statuses are Dutch labels (never the raw enum).
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, placementComments, placements, shiftHours, shifts } from "@/lib/db/schema";
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

export async function clientShiftDetail(clientId: string, shiftId: string) {
  // Ownership IS the lookup — scope by the asking klant; any other shift returns null.
  const [shift] = await db
    .select({
      status: shifts.status,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      role: shifts.roleNeeded,
      headcount: shifts.headcount,
      whenDescription: shifts.whenDescription,
    })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.clientId, clientId)))
    .limit(1);
  if (!shift) return null;

  const [rows, hoursRows, visibleComments] = await Promise.all([
    db
      .select({ status: placements.status, chef: chefs.fullName, placementId: placements.id })
      .from(placements)
      .innerJoin(chefs, eq(chefs.id, placements.chefId))
      .where(eq(placements.shiftId, shiftId)),
    db
      .select({ placementId: shiftHours.placementId, status: shiftHours.status })
      .from(shiftHours)
      .where(eq(shiftHours.shiftId, shiftId)),
    // ONLY client_visible comments — never internal/chef_visible (AVG hard rule).
    db
      .select({ id: placementComments.id })
      .from(placementComments)
      .innerJoin(placements, eq(placements.id, placementComments.placementId))
      .where(and(eq(placements.shiftId, shiftId), eq(placementComments.visibility, "client_visible"))),
  ]);

  const hoursByPlacement = new Map(hoursRows.map((h) => [h.placementId, h.status]));
  // Klanten only ever see chefs that are actually committed to them — hide proposed/
  // rejected/draft churn (those are internal matching state).
  const team = rows
    .filter((r) => FILLED.has(r.status))
    .map((r) => {
      const hoursStatus = hoursByPlacement.get(r.placementId);
      return {
        chef: r.chef,
        status: PLACEMENT_STATUS_NL[r.status] ?? r.status,
        uren: hoursStatus ? humanStatus(hoursStatus) : null,
      };
    });
  const filled = team.length;

  return {
    wanneer: `${dayNl(shift.startsAt)} ${hhmm(shift.startsAt)}–${hhmm(shift.endsAt)}`,
    rol: formatChefRole(shift.role ?? null),
    status: SHIFT_STATUS_NL[shift.status] ?? shift.status,
    bezetting: `${filled}/${shift.headcount}`,
    open: Math.max(0, shift.headcount - filled),
    omschrijving: shift.whenDescription?.trim() || null,
    team,
    opmerkingen: visibleComments.length,
  };
}
