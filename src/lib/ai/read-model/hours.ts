/**
 * Hours read-model — targeted queries the assistant uses to answer "who needs what".
 * Mirrors the admin hours-list join; read-only.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, shiftHours, shifts } from "@/lib/db/schema";
import { humanStatus } from "@/lib/hours-labels";

/** Rows the klant has signed and that now await the owner's (admin) approval. */
export async function listHoursAwaitingApproval() {
  const rows = await db
    .select({
      hoursId: shiftHours.id,
      workedMinutes: shiftHours.workedMinutes,
      chefName: chefs.fullName,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.status, "client_signed"))
    .orderBy(asc(shifts.startsAt))
    .limit(200);
  // Every row here is 'client_signed' by the filter — stamp the human Dutch label so the
  // assistant reports "Door klant akkoord" and can NEVER echo the raw enum (the no-raw-status rule).
  return rows.map((r) => ({ ...r, status: humanStatus("client_signed") }));
}

export type HoursAwaitingApproval = Awaited<ReturnType<typeof listHoursAwaitingApproval>>[number];

/** One hours row with everything needed to remind the blocking party (chef or klant). */
export async function loadHoursReminderTarget(hoursId: string) {
  const [row] = await db
    .select({
      status: shiftHours.status,
      placementId: shiftHours.placementId,
      shiftId: shiftHours.shiftId,
      clientId: shiftHours.clientId,
      chefFullName: chefs.fullName,
      chefEmail: chefs.email,
      chefUserId: chefs.userId,
      clientCompanyName: clients.companyName,
      clientUserId: clients.userId,
      shiftStartsAt: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.id, hoursId))
    .limit(1);
  return row ?? null;
}
