/**
 * Shift domain operations (wave PR-8) — extracted from the /admin/business/shifts/new inline
 * action so the UI and the AI tool (shifts.create, confirm-gated) call the SAME function
 * (the "one verb, one function" rule from AI_INTEGRATION §7).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { clients, placements, shifts, vakniveauEnum } from "@/lib/db/schema";

export const SHIFT_ROLE_VALUES = vakniveauEnum.enumValues;
export type ShiftRole = (typeof SHIFT_ROLE_VALUES)[number];

export type CreateShiftArgs = {
  clientId: string;
  startsAt: Date;
  endsAt: Date;
  roleNeeded: ShiftRole;
  segment?: string | null;
  headcount?: number;
  city?: string | null;
  location?: string | null;
  clientRateCents?: number | null;
  chefRateCents?: number | null;
  notes?: string | null;
  createdBy: string;
};

export type CreateShiftResult =
  | { ok: true; shiftId: string; client: string }
  | { ok: false; error: string };

/** Create an OPEN shift. Validates the klant + times; audits under shifts.create. */
export async function createShift(args: CreateShiftArgs): Promise<CreateShiftResult> {
  if (!(args.startsAt instanceof Date) || isNaN(args.startsAt.getTime())) {
    return { ok: false, error: "Ongeldige starttijd." };
  }
  if (!(args.endsAt instanceof Date) || isNaN(args.endsAt.getTime()) || args.endsAt <= args.startsAt) {
    return { ok: false, error: "Eindtijd moet na de starttijd liggen." };
  }
  if (!SHIFT_ROLE_VALUES.includes(args.roleNeeded)) {
    return { ok: false, error: `Onbekende rol "${args.roleNeeded}".` };
  }
  const [client] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(and(eq(clients.id, args.clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return { ok: false, error: "Deze klant bestaat niet (meer)." };

  const [shift] = await db
    .insert(shifts)
    .values({
      clientId: args.clientId,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      roleNeeded: args.roleNeeded,
      segment: (args.segment ?? null) as never,
      headcount: Math.max(1, args.headcount ?? 1),
      city: args.city ?? null,
      location: args.location ?? null,
      clientRateCents: args.clientRateCents ?? null,
      chefRateCents: args.chefRateCents ?? null,
      notes: args.notes ?? null,
      status: "open",
      createdBy: args.createdBy,
    })
    .returning({ id: shifts.id });

  await recordAuditFromRequest({
    userId: args.createdBy,
    action: "shifts.create",
    resource: "shifts",
    resourceId: shift.id,
    after: { clientId: args.clientId, roleNeeded: args.roleNeeded, headcount: args.headcount ?? 1 },
  });

  return { ok: true, shiftId: shift.id, client: client.companyName };
}

export type UpdateShiftArgs = {
  shiftId: string;
  editorUserId: string;
  startsAt?: Date;
  endsAt?: Date;
  roleNeeded?: ShiftRole;
  headcount?: number;
  clientRateCents?: number;
  chefRateCents?: number;
  city?: string;
  location?: string;
};
export type UpdateShiftResult =
  | { ok: true; shiftId: string; changed: string[] }
  | { ok: false; error: string };

/**
 * Edit an existing shift (time / role / headcount / rate / place). Hard rule (CLAUDE.md):
 * once chefs are CONFIRMED the shift is committed — a change is a REQUEST, never a direct
 * edit — so this refuses when any placement is confirmed and points to the change-request
 * path. Atomic (UPDATE … WHERE status not terminal; 0 rows ⇒ rejected) + audited.
 */
export async function updateShift(args: UpdateShiftArgs): Promise<UpdateShiftResult> {
  const [shift] = await db
    .select({
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      clientRateCents: shifts.clientRateCents,
      chefRateCents: shifts.chefRateCents,
      city: shifts.city,
      location: shifts.location,
      status: shifts.status,
    })
    .from(shifts)
    .where(eq(shifts.id, args.shiftId))
    .limit(1);
  if (!shift) return { ok: false, error: "Deze dienst bestaat niet (meer)." };
  if (shift.status === "completed" || shift.status === "cancelled") {
    return { ok: false, error: "Een afgeronde of geannuleerde dienst kun je niet meer wijzigen." };
  }

  // Committed-chef guard — confirmed chefs ⇒ change is a REQUEST, not a direct edit.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(placements)
    .where(and(eq(placements.shiftId, args.shiftId), eq(placements.status, "confirmed")));
  if (n > 0) {
    return { ok: false, error: "Deze dienst heeft al bevestigde chef(s) — wijzig tijd/rol/aantal/tarief via een wijzigingsverzoek, niet direct." };
  }

  const startsAt = args.startsAt ?? shift.startsAt;
  const endsAt = args.endsAt ?? shift.endsAt;
  if (!(startsAt instanceof Date) || isNaN(new Date(startsAt).getTime())) return { ok: false, error: "Ongeldige starttijd." };
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return { ok: false, error: "Eindtijd moet na de starttijd liggen." };
  if (args.roleNeeded && !SHIFT_ROLE_VALUES.includes(args.roleNeeded)) return { ok: false, error: `Onbekende rol "${args.roleNeeded}".` };
  const headcount = args.headcount != null ? Math.max(1, args.headcount) : shift.headcount;

  // What actually changes (for the audit + a human summary).
  const changed: string[] = [];
  if (args.startsAt && new Date(args.startsAt).getTime() !== new Date(shift.startsAt).getTime()) changed.push("starttijd");
  if (args.endsAt && new Date(args.endsAt).getTime() !== new Date(shift.endsAt).getTime()) changed.push("eindtijd");
  if (args.roleNeeded && args.roleNeeded !== shift.roleNeeded) changed.push("rol");
  if (args.headcount != null && headcount !== shift.headcount) changed.push("aantal plekken");
  if (args.clientRateCents != null && args.clientRateCents !== shift.clientRateCents) changed.push("klanttarief");
  if (args.chefRateCents != null && args.chefRateCents !== shift.chefRateCents) changed.push("cheftarief");
  if (args.city != null && args.city !== shift.city) changed.push("stad");
  if (args.location != null && args.location !== shift.location) changed.push("locatie");
  if (changed.length === 0) return { ok: true, shiftId: args.shiftId, changed };

  const updated = await db
    .update(shifts)
    .set({
      startsAt,
      endsAt,
      roleNeeded: args.roleNeeded ?? shift.roleNeeded,
      headcount,
      clientRateCents: args.clientRateCents ?? shift.clientRateCents,
      chefRateCents: args.chefRateCents ?? shift.chefRateCents,
      city: args.city ?? shift.city,
      location: args.location ?? shift.location,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.id, args.shiftId), inArray(shifts.status, ["request", "open", "filled"])))
    .returning({ id: shifts.id });
  if (updated.length === 0) return { ok: false, error: "Kon de dienst niet wijzigen (status veranderde net)." };

  await recordAuditFromRequest({
    userId: args.editorUserId,
    action: "shifts.updated",
    resource: "shifts",
    resourceId: args.shiftId,
    after: { changed, headcount, roleNeeded: args.roleNeeded ?? shift.roleNeeded },
  });
  return { ok: true, shiftId: args.shiftId, changed };
}
