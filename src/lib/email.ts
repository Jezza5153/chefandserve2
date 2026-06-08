/**
 * Email sending helper — wraps Resend with consistent error handling +
 * best-effort logging to console (Phase 7 polish: log to messages table).
 *
 * All transactional emails route through here so we have one place to:
 *   - Switch sending domains (jezzacooks.com → chefandserve.nl at launch)
 *   - Add rate limiting if Resend quota becomes a concern
 *   - Add bounce/complaint webhook handling later
 */

import { Resend } from "resend";

import { env } from "@/lib/env";

const resend = new Resend(env.RESEND_API_KEY);

export type EmailAttachment = {
  filename: string;
  /** Raw bytes (Buffer) or base64 string — Resend accepts both. */
  content: Buffer | string;
  contentType?: string;
};

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  react: React.ReactElement;
  /** Optional reply-to (e.g. Maarten's email so chefs reply to him not noreply) */
  replyTo?: string;
  /** Optional attachments (e.g. a week .ics so recipients add it to their calendar). */
  attachments?: EmailAttachment[];
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      react: args.react,
      replyTo: args.replyTo,
      attachments: args.attachments,
    });
    if (result.error) {
      console.error("[email] Resend error:", result.error);
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "unknown" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown send error";
    console.error("[email] send threw:", msg);
    return { ok: false, error: msg };
  }
}

/** Format a Date range as "Maandag 15 juni, 18:00–23:00". */
export function formatShiftWhen(startsAt: Date, endsAt: Date): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
