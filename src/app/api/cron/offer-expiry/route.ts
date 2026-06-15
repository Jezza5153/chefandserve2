/**
 * GET /api/cron/offer-expiry — CHEF-PR2 offer-lifecycle sweep.
 *
 * Finds proposals that lapsed un-responded (status='proposed' AND expires_at < now,
 * on a still-future shift) and alerts the OWNER once per placement: "voorstel verlopen
 * — chef reageerde niet, opnieuw voorstellen of andere chef kiezen?". NOTIFY-ONLY: the
 * placement keeps status 'proposed' (no auto-reject/enum change) — Maarten stays the
 * actor and can re-propose or cancel. Per-placement throttle (6 days) so a lingering
 * expired offer doesn't re-nag daily.
 *
 * Thin Railway ticker: workers/offer-expiry.ts. Dark-launched: no-op unless
 * OFFER_EXPIRY_SWEEP_ENABLED=true (the worker re-checks the same flag).
 * Auth: Bearer CRON_SECRET (503 without secret, 401 on mismatch).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, notifications, placements, shifts, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const THROTTLE_DAYS = 6;
const TYPE = "offer_expired";

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** placementIds already notified to the owner for `type` within the throttle window. */
async function recentlyNotified(ownerId: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const since = new Date(Date.now() - THROTTLE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ entityId: notifications.entityId })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ownerId),
        eq(notifications.type, TYPE),
        gt(notifications.createdAt, since),
        inArray(notifications.entityId, entityIds),
      ),
    );
  return new Set(rows.map((r) => r.entityId).filter((x): x is string => Boolean(x)));
}

const firstName = (full: string): string => full.trim().split(/\s+/)[0] || full;
const fmtDay = (d: Date): string =>
  new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short" }).format(d);

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (process.env.OFFER_EXPIRY_SWEEP_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.MAARTEN_EMAIL) {
    return NextResponse.json({ ok: true, skipped: "no owner configured" }, { status: 200 });
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  if (!owner) return NextResponse.json({ ok: true, skipped: "owner not found" }, { status: 200 });

  const now = new Date();
  // Lapsed proposals on still-future shifts (past shifts are moot).
  const expired = await db
    .select({
      placementId: placements.id,
      chefId: placements.chefId,
      chef: chefs.fullName,
      seenAt: placements.seenAt,
      shiftId: shifts.id,
      role: shifts.roleNeeded,
      startsAt: shifts.startsAt,
      client: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.status, "proposed"),
        isNotNull(placements.expiresAt),
        lt(placements.expiresAt, now),
        gt(shifts.startsAt, now),
      ),
    );

  const skip = await recentlyNotified(owner.id, expired.map((e) => e.placementId));
  let notified = 0;
  for (const e of expired) {
    if (skip.has(e.placementId)) continue;
    const seen = e.seenAt ? "gezien maar niet gereageerd" : "nog niet geopend";
    const res = await createNotification({
      userId: owner.id,
      type: TYPE,
      title: `Voorstel verlopen — ${firstName(e.chef)} reageerde niet`,
      body: `${e.role} bij ${e.client ?? "een klant"} (${fmtDay(e.startsAt)}) — ${seen}. Opnieuw voorstellen of een andere chef kiezen?`,
      actionUrl: `/admin/business/shifts/${e.shiftId}`,
      entityType: "placements",
      entityId: e.placementId,
    });
    if (res.ok) notified++;
  }

  return NextResponse.json({ ok: true, found: expired.length, notified }, { status: 200 });
}
