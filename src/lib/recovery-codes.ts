/**
 * Recovery codes — single-use, bcrypt-hashed, lifecycle-tracked.
 *
 * Each user enrolling in 2FA gets 8 codes. Codes are shown once on the
 * enrollment confirmation page, never displayed again. The DB stores
 * only bcrypt hashes.
 *
 * `verifyAndConsume` is atomic: it sets `used_at = now()` only when
 * the row is currently null, so a code can never be redeemed twice
 * even under concurrent requests.
 */

import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { userRecoveryCodes } from "@/lib/db/schema";

/** Edge-safe random bytes — Web Crypto API. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

const CODE_BYTES = 6;        // → 12 hex chars
const TOTAL_CODES = 8;
const BCRYPT_ROUNDS = 10;

/** Format a 12-char code as "ABCD-EFGH-IJKL" for readability. */
function formatCode(hex: string): string {
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12)]
    .join("-")
    .toUpperCase();
}

function normalize(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Generate + bcrypt-hash + persist 8 fresh recovery codes for a user.
 * Returns the plaintext codes (shown once) — caller is responsible for
 * surfacing them to the user and NOT logging them.
 *
 * Replaces any existing recovery codes for the user — call when
 * enrolling/re-enrolling 2FA.
 */
export async function generateAndPersist(userId: string): Promise<string[]> {
  // Drop existing first — we never want orphan codes from a prior enrollment
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));

  const plaintexts: string[] = [];
  const rows: { userId: string; codeHash: string }[] = [];

  for (let i = 0; i < TOTAL_CODES; i++) {
    const code = formatCode(randomHex(CODE_BYTES));
    plaintexts.push(code);
    rows.push({
      userId,
      codeHash: bcrypt.hashSync(normalize(code), BCRYPT_ROUNDS),
    });
  }

  await db.insert(userRecoveryCodes).values(rows);
  return plaintexts;
}

/**
 * Verify + atomically consume a recovery code.
 *
 *  - Loads all unused codes for the user (typically 8 or fewer rows).
 *  - bcrypt-compares each — bcrypt is intentionally slow so the loop is
 *    bounded by TOTAL_CODES (8).
 *  - On match: atomic UPDATE setting used_at=now() WHERE id=? AND used_at IS NULL.
 *    If the UPDATE affects 0 rows, someone else consumed it first.
 *
 * Returns true ONLY when the code was both correct AND the atomic
 * consume succeeded.
 */
export async function verifyAndConsume(
  userId: string,
  rawCode: string,
): Promise<boolean> {
  const candidate = normalize(rawCode);
  if (candidate.length === 0) return false;

  const rows = await db
    .select({ id: userRecoveryCodes.id, codeHash: userRecoveryCodes.codeHash })
    .from(userRecoveryCodes)
    .where(
      and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)),
    );

  for (const row of rows) {
    if (bcrypt.compareSync(candidate, row.codeHash)) {
      // Atomic single-use guard
      const updated = await db
        .update(userRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(userRecoveryCodes.id, row.id),
            isNull(userRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: userRecoveryCodes.id });
      return updated.length === 1;
    }
  }
  return false;
}

/** Counts unused codes for the UI ("3 of 8 codes remaining"). */
export async function countUnused(userId: string): Promise<number> {
  const rows = await db
    .select({ id: userRecoveryCodes.id })
    .from(userRecoveryCodes)
    .where(
      and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)),
    );
  return rows.length;
}

/** Used by the disable flow — wipes all recovery codes for the user. */
export async function clearAll(userId: string): Promise<void> {
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
}
