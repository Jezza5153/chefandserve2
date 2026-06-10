/**
 * Shift domain operations (wave PR-8) — extracted from the /admin/business/shifts/new inline
 * action so the UI and the AI tool (shifts.create, confirm-gated) call the SAME function
 * (the "one verb, one function" rule from AI_INTEGRATION §7).
 */
import { and, eq, isNull } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { clients, shifts, vakniveauEnum } from "@/lib/db/schema";

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
