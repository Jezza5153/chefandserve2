/**
 * GET /api/cron/daily-briefing — assembles the owner's "dagstart" (yesterday recap + today
 * forecast, see read-model/briefing.ts) and delivers it: in-app notification + e-mail to
 * Maarten, plus a gated WhatsApp hook (lights up once a Meta-approved template lands).
 *
 * WHY app-side and not a Railway worker: the briefing reuses the shared read-model (shifts /
 * shift_hours / placement_comments / documents) behind the `@/` alias, which the standalone
 * `workers/` deploy can't import (same reason rag-ingest lives here). So the SCHEDULER is a thin
 * Railway ticker (`workers/daily-briefing.ts`, hourly, Europe/Amsterdam) that reads the owner's
 * chosen hour from business_settings and POSTs THIS endpoint at that hour. The endpoint does the
 * work and is idempotent — `lastSentDate` guards against a double-fire (so a manual hit + the
 * ticker can't double-send on the same day).
 *
 * Auth: Vercel-Cron-style `Authorization: Bearer <CRON_SECRET>`. No secret → 503. The send is
 * gated on the owner's opt-in (business_settings 'daily_briefing'.enabled, default OFF).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getDailyBriefingConfig, setSettingValue, SETTING_KEYS } from "@/lib/business-settings";
import { buildDailyBriefing } from "@/lib/ai/read-model/briefing";
import { createNotification } from "@/lib/integrations/notifications";
import { sendEmail } from "@/lib/email";
import { OwnerMessageEmail } from "@/emails/OwnerMessageEmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve Maarten's user id by the configured MAARTEN_EMAIL (env-required + his account
 *  exists in prod). Null → the endpoint reports "no owner to brief" and no-ops gracefully. */
async function resolveOwnerUserId(): Promise<string | null> {
  if (!env.MAARTEN_EMAIL) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  return u?.id ?? null;
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cfg = await getDailyBriefingConfig();
  if (!cfg.enabled) {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }

  const now = new Date();
  try {
    const briefing = await buildDailyBriefing(now);

    // Idempotent: at most one send per Amsterdam day.
    if (cfg.lastSentDate === briefing.date) {
      return NextResponse.json({ ok: true, skipped: "already_sent", date: briefing.date }, { status: 200 });
    }

    const ownerId = await resolveOwnerUserId();
    if (!ownerId) {
      return NextResponse.json({ ok: false, error: "no owner user to brief" }, { status: 200 });
    }

    const subject = `Je dagstart — ${now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}`;
    const sent: Record<string, unknown> = {};

    if (cfg.channels.app) {
      const r = await createNotification({
        userId: ownerId,
        type: "daily_briefing",
        title: "Je dagstart staat klaar",
        body: briefing.text,
        actionUrl: "/admin/business",
      });
      sent.app = r.ok;
    }
    if (cfg.channels.email && env.MAARTEN_EMAIL) {
      const r = await sendEmail({
        to: env.MAARTEN_EMAIL,
        subject,
        react: OwnerMessageEmail({ title: subject, body: briefing.text }),
      });
      sent.email = r.ok ? true : r.error;
    }
    if (cfg.channels.whatsapp) {
      // Hook is ready; actual send is gated on a Meta-approved template (sent.dm).
      sent.whatsapp = cfg.whatsappTo ? "gated:awaiting_template_approval" : "skipped:no_recipient";
    }

    // Record the dedup marker (preserves the rest of the config).
    await setSettingValue(
      SETTING_KEYS.dailyBriefing,
      {
        enabled: cfg.enabled,
        hour: cfg.hour,
        channels: cfg.channels,
        whatsappTo: cfg.whatsappTo,
        lastSentDate: briefing.date,
      },
      ownerId,
    );

    return NextResponse.json({ ok: true, date: briefing.date, hasUrgent: briefing.hasUrgent, sent }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "briefing failed" },
      { status: 500 },
    );
  }
}
