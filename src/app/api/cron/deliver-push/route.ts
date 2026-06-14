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
import webpush from "web-push";

import { listActiveSubscriptions, pruneDeadSubscription } from "@/lib/domain/push-subscriptions";
import { claimPendingBatch, markFailed, markSent } from "@/lib/integrations/outbox";
import { shouldSendToUser } from "@/lib/integrations/prefs";
import { env } from "@/lib/env";

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
  if (process.env.WEB_PUSH_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return NextResponse.json({ ok: true, skipped: "no VAPID keys" }, { status: 200 });
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const batch = await claimPendingBatch({ provider: "web_push", limit: 50 });
  let sent = 0;
  let skipped = 0;
  let pruned = 0;
  let failed = 0;

  for (const row of batch) {
    const p = row.payloadJson as PushPayload;
    const eventKey = `push:${p.type ?? "all"}`;
    if (!(await shouldSendToUser(p.userId, eventKey))) {
      await markSent(row.id); // muted = delivered-as-skipped (idempotent)
      skipped++;
      continue;
    }
    const subs = await listActiveSubscriptions(p.userId);
    if (subs.length === 0) {
      await markSent(row.id); // nothing to deliver to — not a failure
      skipped++;
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
          pruned++;
        }
      }
    }
    if (anyOk) {
      await markSent(row.id);
      sent++;
    } else {
      // every sub failed transiently (or all were pruned) — let backoff retry
      await markFailed(row.id, "web push: no subscription accepted");
      failed++;
    }
  }

  return NextResponse.json({ ok: true, claimed: batch.length, sent, skipped, pruned, failed }, { status: 200 });
}
