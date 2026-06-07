/**
 * Tiny shared lib for workers — no Next.js dependencies.
 * Workers run as standalone Node processes on Railway.
 */
import { config } from "dotenv";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Resend } from "resend";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL_UNPOOLED) {
  throw new Error("DATABASE_URL_UNPOOLED required");
}

export const sql: NeonQueryFunction<false, false> = neon(
  process.env.DATABASE_URL_UNPOOLED,
);

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export async function audit(
  action: string,
  resource: string,
  resourceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sql`
    INSERT INTO audit_log (action, resource, resource_id, after, created_at)
    VALUES (${action}, ${resource}, ${resourceId}, ${JSON.stringify(details)}, now())
  `;
}

/**
 * Write a row to error_log — the app's minimal Sentry replacement that
 * workers/error-digest.ts reads. Without this, a crashed worker produces ZERO
 * operator signal. Standalone (raw SQL, no src/lib) — same convention as
 * audit() above. There is no `source` column on error_log, so the source/job
 * goes into the `context` jsonb. `severity` is an enum (info|warning|error|
 * critical) defaulting to 'error'.
 */
export async function logError(args: {
  message: string;
  severity?: "info" | "warning" | "error" | "critical";
  context?: Record<string, unknown>;
  stack?: string | null;
}): Promise<void> {
  const severity = args.severity ?? "error";
  await sql`
    INSERT INTO error_log (message, severity, context, stack, created_at)
    VALUES (
      ${args.message},
      ${severity},
      ${JSON.stringify(args.context ?? {})},
      ${args.stack ?? null},
      now()
    )
  `;
}

export async function sendPlainEmail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!process.env.RESEND_FROM_EMAIL) {
    return { ok: false, error: "RESEND_FROM_EMAIL not set" };
  }
  try {
    const r = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    });
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

export function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
