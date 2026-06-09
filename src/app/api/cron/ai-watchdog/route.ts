/**
 * GET /api/cron/ai-watchdog — the §6 decision-point watchdog (AI proposes work unprompted).
 *
 * Runs the three deterministic detectors (read-model/watchdog.ts) and turns each finding into an
 * owner notification WITH a ready-to-use draft/next step:
 *   - stale open shift  → "overweeg tarief verhogen / selectie verbreden" + link to the shift
 *   - silent chef       → a check-in draft Maarten can send (or have the assistant polish)
 *   - low rating (≤2★)  → an apology/follow-up draft + link to the chef's page
 *
 * No auto-sends — drafts only; Maarten stays the actor (rollout step E/F boundary). Per-entity
 * throttle (6 days) so the same finding doesn't re-nag daily. Thin Railway ticker:
 * workers/ai-watchdog.ts. Dark-launched: no-op unless AI_WATCHDOG_ENABLED=true.
 * Auth: Bearer CRON_SECRET (503 without secret, 401 on mismatch).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt, inArray } from "drizzle-orm";

import { runWatchdog } from "@/lib/ai/read-model/watchdog";
import { db } from "@/lib/db/client";
import { notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const THROTTLE_DAYS = 6;
const TYPES = {
  staleShift: "watchdog_stale_shift",
  silentChef: "watchdog_silent_chef",
  lowRating: "watchdog_low_rating",
} as const;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** entityIds already notified for `type` within the throttle window. */
async function recentlyNotified(ownerId: string, type: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const since = new Date(Date.now() - THROTTLE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ entityId: notifications.entityId })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ownerId),
        eq(notifications.type, type),
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
  if (process.env.AI_WATCHDOG_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.MAARTEN_EMAIL) {
    return NextResponse.json({ ok: true, skipped: "no owner configured" }, { status: 200 });
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  if (!owner) return NextResponse.json({ ok: true, skipped: "owner not found" }, { status: 200 });

  const now = new Date();
  const findings = await runWatchdog(now);
  const notified = { staleShifts: 0, silentChefs: 0, lowRatings: 0 };

  // 1) Stale open shifts → tariff/selection suggestion
  {
    const skip = await recentlyNotified(owner.id, TYPES.staleShift, findings.staleOpenShifts.map((s) => s.shiftId));
    for (const s of findings.staleOpenShifts) {
      if (skip.has(s.shiftId)) continue;
      const res = await createNotification({
        userId: owner.id,
        type: TYPES.staleShift,
        title: `Dienst staat al ${s.openForHours} uur open`,
        body: `${s.role} bij ${s.client} (${fmtDay(s.startsAt)}) heeft nog ${s.openSlots} open plek(ken). Overweeg het tarief te verhogen of de selectie te verbreden — of vraag de assistent: "stel chefs voor voor deze dienst".`,
        actionUrl: `/admin/business/shifts/${s.shiftId}`,
        entityType: "shifts",
        entityId: s.shiftId,
      });
      if (res.ok) notified.staleShifts++;
    }
  }

  // 2) Silent chefs → check-in draft
  {
    const skip = await recentlyNotified(owner.id, TYPES.silentChef, findings.silentChefs.map((c) => c.chefId));
    for (const c of findings.silentChefs) {
      if (skip.has(c.chefId)) continue;
      const ago = c.lastSeenDays == null ? "nog nooit" : `${c.lastSeenDays} dagen geleden`;
      const res = await createNotification({
        userId: owner.id,
        type: TYPES.silentChef,
        title: `Al even geen contact met ${c.chef}`,
        body: `Laatste activiteit: ${ago}. Concept-checkin: "Hoi ${firstName(c.chef)}, alles goed? We hebben weer mooie diensten aankomen — heb je binnenkort weer zin en tijd? Groet, Maarten." Stuur 'm via de assistent of bel even.`,
        actionUrl: `/admin/business/chefs/${c.chefId}`,
        entityType: "chefs",
        entityId: c.chefId,
      });
      if (res.ok) notified.silentChefs++;
    }
  }

  // 3) Low ratings → apology/follow-up draft
  {
    const skip = await recentlyNotified(owner.id, TYPES.lowRating, findings.lowRatings.map((r) => r.ratingId));
    for (const r of findings.lowRatings) {
      if (skip.has(r.ratingId)) continue;
      const res = await createNotification({
        userId: owner.id,
        type: TYPES.lowRating,
        title: `Lage beoordeling (${r.stars}★)${r.client ? ` van ${r.client}` : ""}`,
        body: `${r.chef ?? "Een chef"} kreeg ${r.stars}★. Concept-reactie: "Vervelend dat het niet aan de verwachting voldeed — we pakken dit intern op en denken voor de volgende keer graag mee over een passender match." Bel de klant even na en bekijk de feedback.`,
        actionUrl: r.chefId ? `/admin/business/chefs/${r.chefId}` : "/admin/business",
        entityType: "ratings",
        entityId: r.ratingId,
      });
      if (res.ok) notified.lowRatings++;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      found: {
        staleShifts: findings.staleOpenShifts.length,
        silentChefs: findings.silentChefs.length,
        lowRatings: findings.lowRatings.length,
      },
      notified,
    },
    { status: 200 },
  );
}
