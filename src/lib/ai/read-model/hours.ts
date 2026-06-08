/**
 * Hours read-model — targeted queries the assistant uses to answer "who needs what".
 * Mirrors the admin hours-list join; read-only.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, shiftHours, shifts } from "@/lib/db/schema";
import { humanStatus } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";

const eur2 = (cents: number) => `€${(cents / 100).toFixed(2).replace(".", ",")}`;
const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const dtNl = (d: Date | string) => new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

/**
 * One hours row in full, for "kan ik deze uren goedkeuren?" — planned vs actual, rates +
 * margin, the Dutch status label, and (load-bearing for the approve decision + the R10 safety
 * rule) the anomaly flags surfaced PROMINENTLY: schedule deviation > ±30 min, chef/klant notes,
 * missing rate. Mirrors isMagicApproveEligible's rules. Read-only.
 */
export async function hoursDetailForAi(hoursId: string) {
  const [row] = await db
    .select({
      status: shiftHours.status,
      startedAt: shiftHours.startedAt,
      endedAt: shiftHours.endedAt,
      breakMinutes: shiftHours.breakMinutes,
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
      clientRateCents: shiftHours.clientRateCents,
      chefNotes: shiftHours.chefNotes,
      clientNotes: shiftHours.clientNotes,
      clientSignedAt: shiftHours.clientSignedAt,
      chefName: chefs.fullName,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      role: shifts.roleNeeded,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.id, hoursId))
    .limit(1);
  if (!row) return null;

  const scheduledMin = Math.round((new Date(row.shiftEnd).getTime() - new Date(row.shiftStart).getTime()) / 60000);
  const deviationMin = row.workedMinutes - scheduledMin;
  const hoursWorked = row.workedMinutes / 60;
  const omzet = Math.round(row.clientRateCents * hoursWorked);
  const loon = Math.round(row.chefRateCents * hoursWorked);

  const flags: string[] = [];
  if (Math.abs(deviationMin) > 30) {
    flags.push(`rooster-afwijking ${deviationMin > 0 ? "+" : ""}${deviationMin} min (gepland ${(scheduledMin / 60).toFixed(1)}u, werkelijk ${hoursWorked.toFixed(1)}u)`);
  }
  if (row.chefNotes?.trim()) flags.push(`notitie van de chef: "${row.chefNotes.trim()}"`);
  if (row.clientNotes?.trim()) flags.push(`notitie van de klant: "${row.clientNotes.trim()}"`);
  if (!row.chefRateCents || !row.clientRateCents) flags.push("tarief ontbreekt");

  const advies =
    row.status !== "client_signed"
      ? `Deze regel staat op '${humanStatus(row.status)}' — alleen 'Door klant akkoord' kan goedgekeurd worden.`
      : flags.length === 0
        ? "Schoon — geen afwijkingen. Veilig om goed te keuren."
        : "Let op: bekijk de markeringen hierboven vóór je goedkeurt — niet blind goedkeuren.";

  return {
    chef: row.chefName,
    klant: row.clientName,
    rol: formatChefRole(row.role ?? null),
    dienst: `${dayNl(row.shiftStart)} ${hhmm(row.shiftStart)}–${hhmm(row.shiftEnd)}`,
    gepland: `${(scheduledMin / 60).toFixed(1)} uur`,
    werkelijk: `${hoursWorked.toFixed(1)} uur (${hhmm(row.startedAt)}–${hhmm(row.endedAt)}, pauze ${row.breakMinutes} min)`,
    afwijking: `${deviationMin > 0 ? "+" : ""}${deviationMin} min`,
    status: humanStatus(row.status),
    klantAkkoord: row.clientSignedAt ? dtNl(row.clientSignedAt) : null,
    omzet: eur2(omzet),
    loonkosten: eur2(loon),
    marge: eur2(omzet - loon),
    flags,
    advies,
  };
}

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
