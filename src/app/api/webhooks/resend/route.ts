/**
 * /api/webhooks/resend — PR-CHEF-8.
 *
 * Resend delivery events arrive here in real-time. We:
 *   1. Verify the Svix-Signature header (Resend uses Svix for webhooks)
 *      using RESEND_WEBHOOK_SECRET.
 *   2. Parse the event body.
 *   3. Call recordEmailEventFromWebhook() which looks up our
 *      email_messages row by providerMessageId and updates status +
 *      appends to email_events.
 *
 * Public endpoint — no auth gate. Signature IS the auth.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { errorLog } from "@/lib/db/schema";
import { recordEmailEventFromWebhook } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend uses Svix-style HMAC-SHA256 signing on the webhook body with
 * the secret prefixed by `whsec_`. The header format is:
 *   svix-signature: v1,<base64-hmac>
 * We verify the first valid v1 entry.
 */
function verifySignature(args: {
  rawBody: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  secret: string;
}): boolean {
  // Strip the whsec_ prefix and base64-decode
  const cleaned = args.secret.replace(/^whsec_/, "");
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleaned, "base64");
  } catch {
    return false;
  }
  const toSign = `${args.svixId}.${args.svixTimestamp}.${args.rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(toSign).digest("base64");
  // svix-signature can contain multiple "v1,<sig>" entries space-separated
  const candidates = args.svixSignature.split(" ").map((s) => s.trim());
  for (const candidate of candidates) {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) continue;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Webhook configured but env not set — fail loud so this is fixed.
    await db
      .insert(errorLog)
      .values({
        message: "Resend webhook called but RESEND_WEBHOOK_SECRET not set",
        severity: "critical",
        url: "/api/webhooks/resend",
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ ok: false, error: "missing_headers" }, { status: 400 });
  }

  const valid = verifySignature({
    rawBody,
    svixId,
    svixTimestamp,
    svixSignature,
    secret,
  });
  if (!valid) {
    await db
      .insert(errorLog)
      .values({
        message: "Resend webhook signature verification failed",
        severity: "warning",
        url: "/api/webhooks/resend",
        context: { svixId, svixTimestamp },
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  let payload: { type: string; data: { email_id?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const result = await recordEmailEventFromWebhook(payload);
  return NextResponse.json({ ok: result.ok });
}
