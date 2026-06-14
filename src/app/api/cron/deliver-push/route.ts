/**
 * GET /api/cron/deliver-push — drains web_push outbox events to phones (CHEF-14).
 *
 * createNotification() (the bell) already fired inline; notifyUser() enqueued a
 * web_push event. This worker route claims the pending batch and sends each to
 * the user's ACTIVE subscriptions via the Web Push protocol (VAPID-signed,
 * payload-encrypted by the `web-push` lib). Dead endpoints (404/410) are pruned.
 *
 * Idempotent: the outbox idempotency key (notify.push:<notificationId>) dedups
 * re-enqueues; a claimed-and-sent row is never re-sent. Dark: no-op unless
 * WEB_PUSH_ENABLED=true + VAPID keys present. Auth: Bearer CRON_SECRET.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import webpush from "web-push";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { listActiveSubscriptions, pruneDeadSubscription } from "@/lib/domain/push-subscriptions";
import { claimPendingBatch, markFailed, markSent } from "@/lib/integrations/outbox";
import { shouldSendToUser } from "@/lib/integrations/prefs";
import { env } from "@/lib/env";
import { sendWhatsAppTemplate, whatsAppConfigured } from "@/lib/whatsapp";
import type { WaTemplateKey } from "@/lib/whatsapp-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type PushPayload = { userId: string; title: string; body?: string; url?: string; type?: string };

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const webPushOn =
    process.env.WEB_PUSH_ENABLED === "true" &&
    Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  const waOn = process.env.CHEF_WHATSAPP_ENABLED === "true" && whatsAppConfigured();
  if (!webPushOn && !waOn) {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }

  const webPush = { sent: 0, skipped: 0, pruned: 0, failed: 0 };
  const whatsapp = { sent: 0, skipped: 0, failed: 0 };

  // ----- Web Push -----
  if (webPushOn) {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    const batch = await claimPendingBatch({ provider: "web_push", limit: 50 });
    for (const row of batch) {
      const p = row.payloadJson as PushPayload;
      if (!(await shouldSendToUser(p.userId, `push:${p.type ?? "all"}`))) {
        await markSent(row.id);
        webPush.skipped++;
        continue;
      }
      const subs = await listActiveSubscriptions(p.userId);
      if (subs.length === 0) {
        await markSent(row.id);
        webPush.skipped++;
        continue;
      }
      const json = JSON.stringify({ title: p.title, body: p.body ?? "", url: p.url ?? "/chef", tag: p.type });
      let anyOk = false;
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json);
          anyOk = true;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await pruneDeadSubscription(s.endpoint);
            webPush.pruned++;
          }
        }
      }
      if (anyOk) {
        await markSent(row.id);
        webPush.sent++;
      } else {
        await markFailed(row.id, "web push: no subscription accepted");
        webPush.failed++;
      }
    }
  }

  // ----- WhatsApp (CHEF-15) — high-urgency safety net via sent.dm templates -----
  if (waOn) {
    const batch = await claimPendingBatch({ provider: "whatsapp", limit: 50 });
    for (const row of batch) {
      const p = row.payloadJson as {
        userId: string;
        template: string;
        params: Record<string, string | number>;
        type?: string;
      };
      if (!(await shouldSendToUser(p.userId, `whatsapp:${p.type ?? "all"}`))) {
        await markSent(row.id);
        whatsapp.skipped++;
        continue;
      }
      const [chef] = await db
        .select({ phone: chefs.phone })
        .from(chefs)
        .where(eq(chefs.userId, p.userId))
        .limit(1);
      if (!chef?.phone) {
        await markSent(row.id); // no phone on file — nothing to do, not a failure
        whatsapp.skipped++;
        continue;
      }
      const send = await sendWhatsAppTemplate({
        key: p.template as WaTemplateKey,
        to: [chef.phone],
        params: p.params,
      });
      if (send.ok) {
        await markSent(row.id);
        whatsapp.sent++;
      } else {
        await markFailed(row.id, send.error ?? "whatsapp send failed");
        whatsapp.failed++;
      }
    }
  }

  return NextResponse.json({ ok: true, webPush, whatsapp }, { status: 200 });
}
