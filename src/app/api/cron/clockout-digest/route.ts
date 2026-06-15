/**
 * GET /api/cron/clockout-digest — CHEF-PR4b owner clock-out digest.
 *
 * Once a day, summarise recently-finalised shifts that need a second look:
 * planned-vs-actual overrun + the PR-4a clock-out review flags (off-brief, no
 * break, extra hours, won't-return, free note). Sends the OWNER ONE consolidated
 * in-app notification — NOTIFY-ONLY, owner-only (no chef/klant email, so it can't
 * spam external parties), and only when there's something to surface.
 *
 * Idempotent: one digest per Amsterdam-day (a same-day 'clockout_digest'
 * notification short-circuits a re-run). Reuses the getClockoutSignals read-model
 * (PR-10 wraps the same function), so the digest and the reports can't drift.
 *
 * Thin Railway ticker: workers/clockout-digest.ts. Dark-launched: no-op unless
 * CLOCKOUT_DIGEST_ENABLED=true (the worker re-checks the same flag).
 * Auth: Bearer CRON_SECRET (503 without secret, 401 on mismatch).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";
import { getClockoutSignals } from "@/lib/ai/read-model/clockout-signals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPE = "clockout_digest";
const WINDOW_HOURS = 36;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily-throttle floor: 20h before now. The digest runs once a day, so a 20h
 * look-back is a DST-proof window that still guarantees a same-day re-run finds
 * the earlier notification and short-circuits — without the brittleness of
 * computing an exact Amsterdam midnight.
 */
function throttleFloor(now: Date): Date {
  return new Date(now.getTime() - 20 * 60 * 60 * 1000);
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (process.env.CLOCKOUT_DIGEST_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.MAARTEN_EMAIL) {
    return NextResponse.json({ ok: true, skipped: "no owner configured" }, { status: 200 });
  }
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  if (!owner) return NextResponse.json({ ok: true, skipped: "owner not found" }, { status: 200 });

  const now = new Date();

  // Daily throttle: bail if a digest already went out today.
  const [recent] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, owner.id),
        eq(notifications.type, TYPE),
        gt(notifications.createdAt, throttleFloor(now)),
      ),
    )
    .limit(1);
  if (recent) {
    return NextResponse.json({ ok: true, skipped: "already sent today" }, { status: 200 });
  }

  const digest = await getClockoutSignals(WINDOW_HOURS);
  if (digest.attention.length === 0) {
    // Nothing to flag — stay quiet (notification hygiene).
    return NextResponse.json(
      { ok: true, finalised: digest.totalFinalised, attention: 0, notified: 0 },
      { status: 200 },
    );
  }

  const c = digest.counts;
  const parts = [
    c.overrun ? `${c.overrun}× overuren` : null,
    c.offBrief ? `${c.offBrief}× niet zoals afgesproken` : null,
    c.noBreak ? `${c.noBreak}× geen pauze` : null,
    c.extraHours ? `${c.extraHours}× extra uren` : null,
    c.wontReturn ? `${c.wontReturn}× chef wil niet terug` : null,
    c.notes ? `${c.notes}× opmerking` : null,
  ].filter(Boolean);
  const top = digest.attention[0];
  const lead = `${top.chefName} bij ${top.company ?? "een klant"}${top.reasons[0] ? ` — ${top.reasons[0]}` : ""}`;

  const res = await createNotification({
    userId: owner.id,
    type: TYPE,
    title: `Uren-check: ${digest.attention.length} shift${digest.attention.length === 1 ? "" : "s"} met aandachtspunt`,
    body: `${parts.join(" · ")}. Bijv. ${lead}.`,
    actionUrl: "/admin/business/hours",
    entityType: "shift_hours",
    entityId: top.placementId,
  });

  return NextResponse.json(
    {
      ok: true,
      finalised: digest.totalFinalised,
      attention: digest.attention.length,
      notified: res.ok ? 1 : 0,
    },
    { status: 200 },
  );
}
