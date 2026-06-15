/**
 * CHEF-PR2 (R2#13) — replacement handover.
 *
 * When a chef who was already ACCEPTED or CONFIRMED gets pulled off a shift
 * (replaced, or the shift changed last-minute), they were expecting to work — so
 * they get clean comms: "je wordt niet meer verwacht — ga NIET naar de locatie",
 * plus their Arrival Trust monitoring is stopped so a replaced chef can't trip a
 * "nearby" alert. Prevents the worst chef-trust failure: showing up to a shift
 * that's no longer theirs.
 *
 * Dark behind REPLACEMENT_HANDOVER_ENABLED. Idempotent per placement (one handover
 * notice — a re-fire finds the existing notification and no-ops). Best-effort: this
 * is a post-commit side effect of a cancel and must never throw into the mutation.
 */
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, notifications, placements, shifts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { notifyUser } from "@/lib/integrations";
import { stopArrivalMonitoring } from "@/lib/domain/arrival";
import { amsterdamDayKey } from "@/lib/roster-format";

const TYPE = "replacement_handover";

export function replacementHandoverEnabled(): boolean {
  return env.REPLACEMENT_HANDOVER_ENABLED === "true";
}

/** Was the chef committed enough that being cancelled needs a "don't show up" notice? */
export function handoverApplies(priorStatus: string | null | undefined): boolean {
  return priorStatus === "accepted" || priorStatus === "confirmed";
}

/**
 * Fire the handover for a placement that was just cancelled FROM accepted/confirmed.
 * Caller passes the prior status (the canonical cancel path knows it). No-op when
 * the flag is off, the handover doesn't apply, or it already fired for this placement.
 */
export async function sendReplacementHandover(args: {
  placementId: string;
  priorStatus: string | null | undefined;
}): Promise<{ ok: boolean; skipped?: string }> {
  if (!replacementHandoverEnabled()) return { ok: false, skipped: "disabled" };
  if (!handoverApplies(args.priorStatus)) return { ok: false, skipped: "not-applicable" };

  const placement = await db.query.placements.findFirst({
    where: eq(placements.id, args.placementId),
  });
  if (!placement) return { ok: false, skipped: "no-placement" };

  // Idempotency: one handover notice per placement (re-fire finds it and no-ops).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [prior] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, TYPE),
        eq(notifications.entityId, args.placementId),
        gt(notifications.createdAt, since),
      ),
    )
    .limit(1);
  if (prior) return { ok: true, skipped: "already-sent" };

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, placement.chefId) });
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, placement.shiftId) });
  const client = shift
    ? await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) })
    : null;

  // Stop Arrival Trust monitoring regardless of notify outcome (a replaced chef
  // must not keep tripping "nearby"). No-op if nothing was being monitored.
  if (shift) {
    await stopArrivalMonitoring({ chefId: placement.chefId, shiftId: shift.id }).catch((e) =>
      console.error("[replacement-handover] stop monitoring failed:", e),
    );
  }

  if (!chef?.userId) return { ok: true, skipped: "no-chef-user" };

  const when = shift ? amsterdamDayKey(shift.startsAt) : "";
  const where = client?.companyName ?? "de klant";
  await notifyUser({
    userId: chef.userId,
    type: TYPE,
    title: "Je wordt niet meer verwacht — ga niet naar de locatie",
    body: `De shift bij ${where}${when ? ` (${when})` : ""} is voor jou geannuleerd. Ga er NIET heen. Vragen? Bel Maarten.`,
    actionUrl: "/chef",
    entityType: "placements",
    entityId: args.placementId,
    push: true, // urgent: a chef may already be on the road.
  });

  return { ok: true };
}
