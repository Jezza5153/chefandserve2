/**
 * GET /api/cron/shift-reminders — CHEF-PR4 shift-relative reminders.
 *
 * Reminds the chef before a CONFIRMED shift at three tiers: ~24h, ~2h, ~15min.
 * Each tier fires at most once per placement (audit_log breadcrumb idempotency —
 * the document-expiry/hours-reminders idiom, no schema change). We only ever send
 * the MOST-URGENT due tier, so a late-confirmed shift gets the 2h/start reminder,
 * never a stale 24h one. In-app always; push for the 2h + start tiers.
 *
 * NOTIFY-ONLY, chef-only. Thin Railway ticker: workers/shift-reminders.ts (every
 * 15 min). Dark-launched: no-op unless SHIFT_REMINDERS_ENABLED=true (worker
 * re-checks the same flag). Auth: Bearer CRON_SECRET (503 without secret, 401 mismatch).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, chefs, clients, placements, shifts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { notifyUser } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AUDIT_ACTION = "placement.shift_reminder";

// Tiers ordered earliest → latest (least → most urgent). `hours` = "fire once we're
// within this many hours of start". `push` = also send a Web Push.
const TIERS = [
  { key: "24h", hours: 24, push: false },
  { key: "2h", hours: 2, push: true },
  { key: "start", hours: 0.25, push: true },
] as const;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const hhmm = (d: Date): string =>
  new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (process.env.SHIFT_REMINDERS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 26 * 60 * 60 * 1000); // a touch past 24h

  // Confirmed placements on shifts starting in the next ~26h (future only).
  const rows = await db
    .select({
      placementId: placements.id,
      chefUserId: chefs.userId,
      chefName: chefs.fullName,
      startsAt: shifts.startsAt,
      role: shifts.roleNeeded,
      company: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.status, "confirmed"),
        gt(shifts.startsAt, now),
        lte(shifts.startsAt, horizon),
      ),
    );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, sent: 0 }, { status: 200 });
  }

  // Batch-load which tiers already fired for these placements (one query).
  const ids = rows.map((r) => r.placementId);
  const breadcrumbs = await db
    .select({ resourceId: auditLog.resourceId, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.action, AUDIT_ACTION), inArray(auditLog.resourceId, ids)));
  const sentByPlacement = new Map<string, Set<string>>();
  for (const b of breadcrumbs) {
    if (!b.resourceId) continue;
    const tier = (b.after as { tier?: string } | null)?.tier;
    if (!tier) continue;
    const set = sentByPlacement.get(b.resourceId) ?? new Set<string>();
    set.add(tier);
    sentByPlacement.set(b.resourceId, set);
  }

  let sent = 0;
  for (const r of rows) {
    if (!r.chefUserId) continue;
    const hoursUntil = (new Date(r.startsAt).getTime() - now.getTime()) / 3_600_000;

    // Most-urgent tier whose window we've entered (highest index with hoursUntil <= hours).
    let dueIdx = -1;
    for (let i = 0; i < TIERS.length; i++) if (hoursUntil <= TIERS[i].hours) dueIdx = i;
    if (dueIdx === -1) continue; // not within 24h yet

    const tier = TIERS[dueIdx];
    if (sentByPlacement.get(r.placementId)?.has(tier.key)) continue; // already fired

    const where = r.company ?? "een klant";
    const when = hhmm(new Date(r.startsAt));
    const { title, body } =
      tier.key === "24h"
        ? { title: `Morgen: ${where}`, body: `${r.role} om ${when}. Tot morgen!` }
        : tier.key === "2h"
          ? { title: `Over ~2 uur: ${where}`, body: `Je shift start om ${when}. Klaar om te gaan?` }
          : { title: `Bijna tijd — ${where}`, body: `Start om ${when}. Veel succes!` };

    const res = await notifyUser({
      userId: r.chefUserId,
      type: `shift_reminder_${tier.key}`,
      title,
      body,
      actionUrl: `/chef/shifts/${r.placementId}`,
      entityType: "placement",
      entityId: r.placementId,
      push: tier.push,
    });
    if (res.ok) {
      sent++;
      await db
        .insert(auditLog)
        .values({
          action: AUDIT_ACTION,
          resource: "placements",
          resourceId: r.placementId,
          after: { tier: tier.key },
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, candidates: rows.length, sent }, { status: 200 });
}
