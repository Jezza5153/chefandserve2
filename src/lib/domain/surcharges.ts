/**
 * Surcharges: reading the rules, and freezing the computed amounts onto an hours row.
 *
 * The split with `src/lib/surcharges.ts` is deliberate — that file is the pure arithmetic
 * (which minute belongs to which rule, in Amsterdam local time, DST included) and this one
 * is everything that touches the database.
 *
 * The amounts are computed ONCE, at approval, and stored. They are never recomputed from
 * the live rules afterwards: an approved hour has been invoiced and paid out, and a rule
 * edited in March must not silently restate what was billed in January. That is the same
 * reason the invoice carries a billing snapshot.
 *
 * With no enabled rules — which is how this ships — every function here is a no-op and
 * every amount in the system stays exactly what it is today.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { shiftHourSurcharges, surchargeRules } from "@/lib/db/schema";
import { berekenToeslagen, type ToeslagRegel } from "@/lib/surcharges";

export type ToeslagRegelRij = ToeslagRegel & {
  enabled: boolean;
  updatedAt: Date;
};

export async function listSurchargeRules(alleenActief = false): Promise<ToeslagRegelRij[]> {
  const rows = (await db
    .select()
    .from(surchargeRules)
    .where(alleenActief ? eq(surchargeRules.enabled, true) : undefined)
    .orderBy(asc(surchargeRules.priority), asc(surchargeRules.code))) as (typeof surchargeRules.$inferSelect)[];

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    kind: r.kind,
    startMinuteOfDay: r.startMinuteOfDay,
    endMinuteOfDay: r.endMinuteOfDay,
    weekdays: r.weekdays,
    leadTimeHours: r.leadTimeHours,
    clientPctBps: r.clientPctBps,
    chefPctBps: r.chefPctBps,
    priority: r.priority,
    enabled: r.enabled,
    updatedAt: r.updatedAt,
  }));
}

/** Is anything actually switched on? Surfaces use this to stay quiet until finance fills it in. */
export async function heeftActieveToeslagen(): Promise<boolean> {
  const regels = await listSurchargeRules(true);
  return regels.some((r) => r.clientPctBps > 0 || r.chefPctBps > 0);
}

export type ToeslagTotaal = { clientCents: number; chefCents: number };

/**
 * Compute and store the surcharges for one hours row.
 *
 * Idempotent by design: the unique index on (shift_hours_id, rule_code) plus
 * `onConflictDoNothing` means re-approving a row cannot double an amount. Returns the
 * totals so the caller can roll them up.
 */
export async function berekenEnBewaarToeslagen(args: {
  shiftHoursId: string;
  van: Date;
  tot: Date;
  pauzeMinuten: number;
  baseClientRateCents: number;
  baseChefRateCents: number;
  leadTimeHours: number | null;
}): Promise<ToeslagTotaal> {
  const regels = await listSurchargeRules(true);
  if (regels.length === 0) return { clientCents: 0, chefCents: 0 };

  const uitkomsten = berekenToeslagen({
    van: args.van,
    tot: args.tot,
    pauzeMinuten: args.pauzeMinuten,
    baseClientRateCents: args.baseClientRateCents,
    baseChefRateCents: args.baseChefRateCents,
    leadTimeHours: args.leadTimeHours,
    regels,
  });
  if (uitkomsten.length === 0) return { clientCents: 0, chefCents: 0 };

  for (const u of uitkomsten) {
    await db
      .insert(shiftHourSurcharges)
      .values({
        shiftHoursId: args.shiftHoursId,
        ruleId: u.regelId,
        ruleCode: u.code,
        label: u.label,
        minutes: u.minuten,
        clientPctBps: u.clientPctBps,
        chefPctBps: u.chefPctBps,
        baseClientRateCents: args.baseClientRateCents,
        baseChefRateCents: args.baseChefRateCents,
        clientAmountCents: u.clientAmountCents,
        chefAmountCents: u.chefAmountCents,
      })
      .onConflictDoNothing({ target: [shiftHourSurcharges.shiftHoursId, shiftHourSurcharges.ruleCode] });
  }

  return {
    clientCents: uitkomsten.reduce((s, u) => s + u.clientAmountCents, 0),
    chefCents: uitkomsten.reduce((s, u) => s + u.chefAmountCents, 0),
  };
}

export type BewaardeToeslag = {
  code: string;
  label: string;
  minuten: number;
  clientAmountCents: number;
  chefAmountCents: number;
  clientPctBps: number;
};

/** What was frozen onto this hours row — for the invoice, the payout and the UI. */
export async function getToeslagenVoorUren(shiftHoursId: string): Promise<BewaardeToeslag[]> {
  const rows = (await db
    .select({
      code: shiftHourSurcharges.ruleCode,
      label: shiftHourSurcharges.label,
      minuten: shiftHourSurcharges.minutes,
      clientAmountCents: shiftHourSurcharges.clientAmountCents,
      chefAmountCents: shiftHourSurcharges.chefAmountCents,
      clientPctBps: shiftHourSurcharges.clientPctBps,
    })
    .from(shiftHourSurcharges)
    .where(eq(shiftHourSurcharges.shiftHoursId, shiftHoursId))
    .orderBy(asc(shiftHourSurcharges.ruleCode))) as BewaardeToeslag[];
  return rows;
}

export type RegelInvoer = {
  code: string;
  label: string;
  kind: ToeslagRegel["kind"];
  startMinuteOfDay: number | null;
  endMinuteOfDay: number | null;
  weekdays: number[] | null;
  leadTimeHours: number | null;
  clientPctBps: number;
  chefPctBps: number;
  priority: number;
  enabled: boolean;
};

export type RegelResultaat = { ok: true } | { ok: false; error: string };

/** Validate what finance typed. Refuses a rule that would silently never match. */
export function valideerRegel(r: RegelInvoer): RegelResultaat {
  if (!r.code.trim()) return { ok: false, error: "Geef de regel een code." };
  if (!r.label.trim()) return { ok: false, error: "Geef de regel een naam die op de factuur mag staan." };
  if (r.clientPctBps < 0 || r.chefPctBps < 0) return { ok: false, error: "Een toeslag kan niet negatief zijn." };
  if (r.clientPctBps > 20_000 || r.chefPctBps > 20_000) {
    return { ok: false, error: "Meer dan 200% toeslag is vrijwel zeker een typefout." };
  }
  switch (r.kind) {
    case "time_window":
      if (r.startMinuteOfDay == null || r.endMinuteOfDay == null) {
        return { ok: false, error: "Vul een begin- en eindtijd in." };
      }
      if (r.startMinuteOfDay === r.endMinuteOfDay) {
        return { ok: false, error: "Begin- en eindtijd zijn gelijk — dan geldt de regel nooit." };
      }
      break;
    case "weekday":
      if (!r.weekdays || r.weekdays.length === 0) return { ok: false, error: "Kies minstens één dag." };
      if (r.weekdays.some((d) => d < 1 || d > 7)) return { ok: false, error: "Ongeldige weekdag." };
      break;
    case "spoed":
      if (!r.leadTimeHours || r.leadTimeHours <= 0) {
        return { ok: false, error: "Vul in binnen hoeveel uur voor aanvang een dienst als spoed telt." };
      }
      break;
    case "holiday":
      break;
  }
  return { ok: true };
}

export async function upsertSurchargeRule(r: RegelInvoer, userId: string): Promise<RegelResultaat> {
  const geldig = valideerRegel(r);
  if (!geldig.ok) return geldig;

  await db
    .insert(surchargeRules)
    .values({ ...r, code: r.code.trim(), label: r.label.trim(), updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: surchargeRules.code,
      set: {
        label: r.label.trim(),
        kind: r.kind,
        startMinuteOfDay: r.startMinuteOfDay,
        endMinuteOfDay: r.endMinuteOfDay,
        weekdays: r.weekdays,
        leadTimeHours: r.leadTimeHours,
        clientPctBps: r.clientPctBps,
        chefPctBps: r.chefPctBps,
        priority: r.priority,
        enabled: r.enabled,
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });
  return { ok: true };
}

export async function deleteSurchargeRule(code: string): Promise<void> {
  // The snapshots keep their own copy of code, label and percentages, so removing a rule
  // never disturbs an amount that was already booked.
  await db.delete(surchargeRules).where(and(eq(surchargeRules.code, code)));
}
