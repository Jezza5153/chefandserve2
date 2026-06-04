/**
 * Rate limiter — fixed-window counter with HMAC-hashed keys.
 *
 * PR-S1A. AVG hardening: we never store raw email or IP. Each `(scope,
 * identifier)` pair is HMAC-sha256'd into a single column primary key.
 *
 * Critical design rule (do not change without re-reading the plan):
 *   The IP-only scope key derivation MUST NOT include the email — otherwise
 *   an attacker rotates emails to bypass the IP-per-hour ceiling.
 *
 *   magic_link_email  → hash(scope + ":" + lower(trim(email)))      3 / 10 min
 *   magic_link_ip     → hash(scope + ":" + normalizedIp)            10 / hour
 *   totp_verify       → hash(scope + ":" + userId)                  5 / 5 min
 *
 * Two gates per login:
 *   hitOrThrow("magic_link_email", email,  3, 600)
 *   hitOrThrow("magic_link_ip",    ip,    10, 3600)
 *
 * Atomic UPSERT keeps the operation race-free under concurrent requests.
 */

import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env";

export type RateLimitScope =
  | "magic_link_email"
  | "magic_link_ip"
  | "totp_verify"
  | "chef_apply_ip"
  | "client_request_ip"
  | "intake_webhook_ip";

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/* ---------- key derivation ------------------------------------------------ */

function requireSecret(): string {
  const s = env.RATE_LIMIT_HASH_SECRET;
  if (!s) {
    throw new Error(
      "RATE_LIMIT_HASH_SECRET is not set. Generate one via " +
        "`openssl rand -base64 32` and add to Vercel env (production + " +
        "preview + development).",
    );
  }
  return s;
}

/** Stable derivation. Lowercase + trim email; trust caller for IP/userId shape. */
export function hashKey(scope: RateLimitScope, identifier: string): string {
  const norm =
    scope === "magic_link_email" ? identifier.trim().toLowerCase() : identifier;
  return createHmac("sha256", requireSecret())
    .update(`${scope}:${norm}`)
    .digest("hex");
}

/* ---------- IP normalization --------------------------------------------- */

/** Extract first non-empty IP from `x-forwarded-for`, fall back to a sentinel. */
export function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/* ---------- hit logic ---------------------------------------------------- */

/**
 * Atomic increment-or-create within the window.
 *
 * Returns `{ ok: true }` on hit allowed, `{ ok: false, retryAfterSec }` when
 * the threshold has been exceeded. Audit-log writes are the caller's job.
 */
export async function hitOrThrow(
  scope: RateLimitScope,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const keyHash = hashKey(scope, identifier);
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  // Single round-trip atomic UPSERT.
  //
  //  - If row doesn't exist: insert with count=1, window_start=now.
  //  - If row exists AND window is expired (now - window_start > windowSec):
  //      reset count to 1, advance window_start to now.
  //  - If row exists AND within window: count = count + 1.
  //
  // Then we read back count to decide allow/reject.
  const result = await db.execute(sql`
    INSERT INTO rate_limits (key_hash, scope, count, window_start, updated_at)
    VALUES (${keyHash}, ${scope}, 1, to_timestamp(${now / 1000}), to_timestamp(${now / 1000}))
    ON CONFLICT (key_hash) DO UPDATE
       SET count        = CASE
             WHEN rate_limits.window_start + (${windowSeconds} || ' seconds')::interval < now()
               THEN 1
             ELSE rate_limits.count + 1
           END,
           window_start = CASE
             WHEN rate_limits.window_start + (${windowSeconds} || ' seconds')::interval < now()
               THEN now()
             ELSE rate_limits.window_start
           END,
           updated_at   = now()
    RETURNING count, EXTRACT(EPOCH FROM window_start)::int AS window_start_epoch
  `);

  // Drizzle Neon HTTP driver returns `result` shape — check both common shapes
  const row = Array.isArray(result)
    ? (result[0] as { count?: number; window_start_epoch?: number } | undefined)
    : (
        (result as unknown as { rows?: Array<{ count?: number; window_start_epoch?: number }> })
          .rows?.[0]
      );

  const count = Number(row?.count ?? 0);
  const windowStartEpoch = Number(row?.window_start_epoch ?? now / 1000);

  if (count <= max) {
    return { ok: true, remaining: max - count };
  }

  const elapsedMs = now - windowStartEpoch * 1000;
  const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
  return { ok: false, retryAfterSec };
}

/* ---------- standard thresholds ------------------------------------------ */

export const THRESHOLDS = {
  magic_link_email: { max: 3, windowSeconds: 10 * 60 },
  magic_link_ip: { max: 10, windowSeconds: 60 * 60 },
  totp_verify: { max: 5, windowSeconds: 5 * 60 },
  // Public chef-application form: 5 submissions per IP per hour.
  chef_apply_ip: { max: 5, windowSeconds: 60 * 60 },
  // Public klant staff-request form: 5 submissions per IP per hour.
  client_request_ip: { max: 5, windowSeconds: 60 * 60 },
  // Public Jotform intake webhooks (legacy, being retired): cap injection abuse.
  intake_webhook_ip: { max: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<RateLimitScope, { max: number; windowSeconds: number }>;

/** Convenience wrapper using the standard thresholds. */
export async function checkRateLimit(
  scope: RateLimitScope,
  identifier: string,
): Promise<RateLimitResult> {
  const { max, windowSeconds } = THRESHOLDS[scope];
  return hitOrThrow(scope, identifier, max, windowSeconds);
}
