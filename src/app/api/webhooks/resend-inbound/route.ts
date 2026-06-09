/**
 * POST /api/webhooks/resend-inbound — chef/klant e-mail RECEIVED via Resend inbound.
 *
 * SEPARATE from the OUTBOUND /api/webhooks/resend (delivery/bounce, owned elsewhere) — this handles
 * INBOUND only. svix-signed with RESEND_INBOUND_SECRET. Dark-launched: 503 until that secret is set
 * AND the owner configures Resend inbound (MX records + inbound route). Lands the raw payload in
 * webhooks_received (audit) then matches / classifies / stores / notifies via processInboundEmail.
 *
 * SECURITY: signature is verified before processing; sender content is UNTRUSTED (stored as data,
 * never instructions). Returns 200 on processing errors so a bad single email can't wedge retries.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { webhooksReceived } from "@/lib/db/schema";
import { processInboundEmail } from "@/lib/domain/inbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifySignature(args: {
  rawBody: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  secret: string;
}): boolean {
  const cleaned = args.secret.replace(/^whsec_/, "");
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleaned, "base64");
  } catch {
    return false;
  }
  const toSign = `${args.svixId}.${args.svixTimestamp}.${args.rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(toSign).digest("base64");
  for (const candidate of args.svixSignature.split(" ").map((s) => s.trim())) {
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

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * The real email.received webhook carries METADATA ONLY (email_id/from/to/subject/message_id —
 * no body). Best-effort: fetch the body via GET /emails/receiving/{id}. Graceful on failure —
 * a send-only restricted RESEND_API_KEY gets 401 here, and we proceed with subject-only
 * classification (bodies start flowing the moment the key gains receiving-read).
 */
async function fetchReceivedBody(emailId: string): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    const html = str(d.html);
    return str(d.text) ?? (html ? html.replace(/<[^>]+>/g, " ") : null);
  } catch {
    return null;
  }
}

/** Pull the inbound fields out of Resend's payload, defensively (shape may vary). */
function extract(payload: unknown): {
  fromRaw: string;
  to: string | null;
  subject: string | null;
  bodyText: string | null;
  messageId: string | null;
  emailId: string | null;
} | null {
  const root = (payload ?? {}) as Record<string, unknown>;
  const d = (root.data ?? root) as Record<string, unknown>;
  const fromVal = d.from;
  const fromRaw =
    typeof fromVal === "string"
      ? fromVal
      : str((fromVal as Record<string, unknown> | null)?.email) ?? str(d.sender) ?? "";
  if (!fromRaw) return null;

  let to: string | null = null;
  if (Array.isArray(d.to)) {
    to =
      d.to
        .map((x) => (typeof x === "string" ? x : str((x as Record<string, unknown> | null)?.email)))
        .filter(Boolean)
        .join(", ") || null;
  } else if (typeof d.to === "string") {
    to = d.to;
  } else {
    to = str((d.to as Record<string, unknown> | null)?.email);
  }

  const html = str(d.html);
  const bodyText = str(d.text) ?? str(d.body) ?? (html ? html.replace(/<[^>]+>/g, " ") : null);
  const messageId = str(d.message_id) ?? str(d.messageId) ?? str(d.id) ?? str(root.id);
  return { fromRaw, to, subject: str(d.subject), bodyText, messageId, emailId: str(d.email_id) };
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) {
    // Dark-launched: inbound not configured yet (no secret / no MX route). Stay quiet.
    return NextResponse.json({ ok: true, skipped: "inbound_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ ok: false, error: "missing_headers" }, { status: 400 });
  }

  const valid = verifySignature({ rawBody, svixId, svixTimestamp, svixSignature, secret });

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    /* keep null — recorded as unparseable below */
  }
  await db
    .insert(webhooksReceived)
    .values({
      source: "resend_inbound",
      payload: (payload ?? { unparseable: true }) as object,
      headers: { "svix-id": svixId } as object,
      signatureValid: valid,
    })
    .catch(() => {});

  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  const fields = extract(payload);
  if (!fields) {
    return NextResponse.json({ ok: true, skipped: "unparseable" }, { status: 200 });
  }

  try {
    const bodyText =
      fields.bodyText ?? (fields.emailId ? await fetchReceivedBody(fields.emailId) : null);
    const r = await processInboundEmail({
      fromRaw: fields.fromRaw,
      to: fields.to,
      subject: fields.subject,
      bodyText,
      providerMessageId: fields.messageId ?? fields.emailId,
      provider: "resend",
    });
    return NextResponse.json({ ok: true, ...r }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "process_failed" }, { status: 200 });
  }
}
