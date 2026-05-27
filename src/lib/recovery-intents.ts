/**
 * Recovery intents — purpose-bound, single-use account recovery tokens.
 *
 * PR-C / Fence 5. Used by /login/forgot-password and /login/lost-2fa.
 *
 *   createIntent(userId, intent) → opaque token (64-char hex)
 *   consumeIntent(token, intent) → { userId } on success, null on:
 *     - missing/unknown token
 *     - intent mismatch (forgot-password token used on /recover/2fa, etc.)
 *     - expired (>15 min)
 *     - already consumed
 *
 * All consume operations are atomic: UPDATE ... SET consumed_at = now()
 * WHERE token = ? AND consumed_at IS NULL AND expires_at > now() AND
 * intent = ?. If 0 rows affected → token is unusable. No race-condition
 * window for double-consume.
 *
 * Token = 32 random bytes hex (64 chars, 256 bits entropy — well above
 * the practical-guess threshold).
 */

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recoveryIntents } from "@/lib/db/schema";

export type RecoveryIntentKind = "password" | "totp";

/** Token TTL — 15 minutes. Short on purpose; user clicks the email quickly. */
const TTL_MS = 15 * 60 * 1000;

function randomToken(): string {
  // 32 bytes → 64 hex chars → 256 bits of entropy. crypto.getRandomValues is
  // edge-safe (Web Crypto API), same approach as recovery-codes.ts.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Mint a fresh recovery intent for a user. Returns the opaque token to
 * embed in the recovery URL — never store this anywhere except the email.
 *
 * Multiple unconsumed intents can exist concurrently for a user (e.g. they
 * triggered "forgot password" twice). The latest one is the one that
 * matters; older ones still expire normally.
 */
export async function createIntent(
  userId: string,
  intent: RecoveryIntentKind,
): Promise<string> {
  const token = randomToken();
  await db.insert(recoveryIntents).values({
    token,
    userId,
    intent,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * Look up an unconsumed, unexpired intent matching this token AND intent
 * kind. Used by the recovery pages to render the form: if this returns
 * null, the page shows "link expired or invalid". No mutation.
 */
export async function peekIntent(
  token: string,
  intent: RecoveryIntentKind,
): Promise<{ userId: string } | null> {
  if (!token || token.length !== 64) return null;
  const [row] = await db
    .select({ userId: recoveryIntents.userId })
    .from(recoveryIntents)
    .where(
      and(
        eq(recoveryIntents.token, token),
        eq(recoveryIntents.intent, intent),
        isNull(recoveryIntents.consumedAt),
        gt(recoveryIntents.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ? { userId: row.userId } : null;
}

/**
 * Atomically consume the token. Returns the user id on success, null on
 * any failure (expired, wrong intent, already used, unknown token).
 *
 * Single round-trip: UPDATE ... WHERE clause does all guards. The RETURNING
 * clause confirms we actually flipped a row.
 */
export async function consumeIntent(
  token: string,
  intent: RecoveryIntentKind,
): Promise<{ userId: string } | null> {
  if (!token || token.length !== 64) return null;
  const updated = await db
    .update(recoveryIntents)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(recoveryIntents.token, token),
        eq(recoveryIntents.intent, intent),
        isNull(recoveryIntents.consumedAt),
        gt(recoveryIntents.expiresAt, new Date()),
      ),
    )
    .returning({ userId: recoveryIntents.userId });
  return updated[0] ? { userId: updated[0].userId } : null;
}

/**
 * Pruning helper — called by the retention worker (PR-AVG1) to drop
 * intents older than 24h (consumed or expired). Not used in request path.
 */
export async function pruneExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    DELETE FROM recovery_intents
    WHERE created_at < ${cutoff.toISOString()}
    RETURNING token
  `);
  // neon-http result shape
  const rows = Array.isArray(result)
    ? result
    : ((result as unknown as { rows?: unknown[] }).rows ?? []);
  return rows.length;
}
