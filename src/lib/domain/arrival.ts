/**
 * CHEF-PR3 — Arrival Trust (Aankomstzekerheid). PRIVACY-FIRST.
 *
 * Chef & Serve does NOT live-track chefs. The PWA checks the 1 km radius ON THE
 * CHEF'S PHONE (client-side haversine to the shift's job-site) and POSTs only the
 * RESULT — an event, never coordinates, never a route. This module records that
 * event in `shift_arrival_checks` (no lat/lng) and, on "nearby", tells the owner +
 * klant the chef is close. Notify-discipline: the klant only ever hears
 * nearby/delayed/replaced — never permission-missing / no-signal / internal alerts.
 *
 * Dark behind ARRIVAL_TRUST_ENABLED. Ownership IS the lookup: only a chef placed
 * (accepted/confirmed) on the shift can record an event for it.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftArrivalChecks, shifts, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations";
import { amsterdamDayKey } from "@/lib/roster-format";

export type ArrivalEvent = "monitoring" | "nearby" | "no_signal" | "permission_missing" | "stopped";

export function arrivalTrustEnabled(): boolean {
  return env.ARRIVAL_TRUST_ENABLED === "true";
}

/**
 * Record an on-device arrival result. The chef's phone computed the 1 km check;
 * we store only the event. Returns {ok:false} when the flag is off or the chef
 * isn't actually placed on the shift (no spoofing another chef's arrival).
 */
export async function recordArrivalEvent(args: {
  chefId: string;
  shiftId: string;
  event: ArrivalEvent;
}): Promise<{ ok: boolean }> {
  if (!arrivalTrustEnabled()) return { ok: false };

  // Ownership: a live placement on THIS shift is required.
  const placement = await db.query.placements.findFirst({
    where: and(eq(placements.chefId, args.chefId), eq(placements.shiftId, args.shiftId)),
  });
  if (!placement || !["accepted", "confirmed"].includes(placement.status)) return { ok: false };

  const now = new Date();
  await db
    .insert(shiftArrivalChecks)
    .values({
      shiftId: args.shiftId,
      chefId: args.chefId,
      status: args.event,
      nearbyConfirmedAt: args.event === "nearby" ? now : null,
      stoppedAt: args.event === "stopped" ? now : null,
    })
    .onConflictDoUpdate({
      target: [shiftArrivalChecks.shiftId, shiftArrivalChecks.chefId],
      set: {
        status: args.event,
        updatedAt: now,
        ...(args.event === "nearby" ? { nearbyConfirmedAt: now } : {}),
        ...(args.event === "stopped" ? { stoppedAt: now } : {}),
      },
    });

  // Only "nearby" reaches the owner + klant (notify-discipline). The internal
  // states (permission_missing / no_signal) stay in the row for the owner's
  // dispute view — they are NEVER pushed to the klant.
  if (args.event === "nearby") {
    await notifyNearby(args.chefId, args.shiftId).catch((e) =>
      console.error("[arrival] nearby notify failed:", e),
    );
  }
  return { ok: true };
}

/**
 * CHEF-PR2 (R2#13): force-stop arrival monitoring for a placement, regardless of
 * the placement's current status. Used by replacement-handover — by the time a
 * confirmed chef is pulled off the shift the placement is already 'cancelled', so
 * recordArrivalEvent's accepted/confirmed gate wouldn't apply. Only flips an
 * EXISTING active row to 'stopped' (never creates one). No-op when there's nothing
 * being monitored. Safe to call unconditionally (idempotent).
 */
export async function stopArrivalMonitoring(args: {
  chefId: string;
  shiftId: string;
}): Promise<{ stopped: boolean }> {
  const now = new Date();
  const updated = await db
    .update(shiftArrivalChecks)
    .set({ status: "stopped", stoppedAt: now, updatedAt: now })
    .where(
      and(
        eq(shiftArrivalChecks.shiftId, args.shiftId),
        eq(shiftArrivalChecks.chefId, args.chefId),
      ),
    )
    .returning({ id: shiftArrivalChecks.id });
  return { stopped: updated.length > 0 };
}

async function notifyNearby(chefId: string, shiftId: string): Promise<void> {
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  if (!shift) return;
  const client = await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) });
  const when = amsterdamDayKey(shift.startsAt);
  const chefName = chef?.fullName ?? "De chef";

  // Owner — full detail (no map, no coords).
  if (env.MAARTEN_EMAIL) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, env.MAARTEN_EMAIL))
      .limit(1);
    if (owner) {
      await createNotification({
        userId: owner.id,
        type: "arrival_nearby",
        title: `${chefName} is binnen 1 km van ${client?.companyName ?? "de locatie"}`,
        body: `${shift.roleNeeded} — ${when}. Aankomstsignaal ontvangen.`,
        actionUrl: `/admin/business/shifts/${shiftId}`,
        entityType: "shifts",
        entityId: shiftId,
      });
    }
  }
  // Klant — reassuring, no detail/coords.
  if (client?.userId) {
    await createNotification({
      userId: client.userId,
      type: "arrival_nearby",
      title: "Je chef is in de buurt",
      body: "De chef is vlakbij en komt eraan. We houden deze dienst in de gaten.",
      actionUrl: `/client/shifts/${shiftId}`,
      entityType: "shifts",
      entityId: shiftId,
    });
  }
}
