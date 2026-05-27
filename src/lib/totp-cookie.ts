/**
 * 2FA verification cookie — PR-S2B + PR-C0.
 *
 * Auth.js issues the JWT session normally on magic-link/credentials
 * callback. To gate /admin/* on a second factor for internal users we
 * use a separate signed HttpOnly cookie, decoupled from the session.
 *
 * Cookie name:  cs_2fa_verified
 *
 * Format (v2 — PR-C0 versioned):
 *   v2.userId.enrolledAtMs.expiresAtMs.hmac
 *
 *   hmac = hmac_sha256(SECRET, "v2." + userId + "." + enrolledAtMs + "." + expiresAtMs)
 *
 * Why include enrolledAtMs:
 *   When an admin resets a user's 2FA, we wipe users.totp_enrolled_at and
 *   bump permissions_version. The bumped permissions_version invalidates
 *   the user's JWT entirely on next request (jwt callback returns null).
 *   But on a DIFFERENT browser where the user may have a stale cs_2fa_verified
 *   cookie, the JWT may still be valid for a few seconds until the next
 *   permissionsVersion check fires. By embedding enrolledAtMs in the cookie
 *   and comparing it to the live DB value, we reject the cookie as soon as
 *   the database state changes — regardless of JWT freshness.
 *
 * v1 cookies (without "v2." prefix) are rejected on sight — the user
 * re-prompts and gets a v2 cookie on next mint.
 *
 * Web Crypto API (SubtleCrypto) used throughout so this module is safe in
 * both Node runtime (server actions) and Edge runtime (middleware).
 */

const COOKIE_NAME = "cs_2fa_verified";
const VERSION = "v2";

function getRawKey(): string {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY missing — required to sign the 2FA cookie",
    );
  }
  return key;
}

let cachedCryptoKey: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  const raw = new TextEncoder().encode(getRawKey());
  cachedCryptoKey = crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedCryptoKey;
}

function toHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) return null;
    out[i] = v;
  }
  return out;
}

async function sign(payload: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toHex(sig);
}

async function verifySig(payload: string, expectedHex: string): Promise<boolean> {
  const expected = fromHex(expectedHex);
  if (!expected) return false;
  const key = await getKey();
  const sigBuf = expected.slice().buffer;
  const dataBuf = new TextEncoder().encode(payload).slice().buffer;
  return crypto.subtle.verify("HMAC", key, sigBuf, dataBuf);
}

/* ---------- public API ----------------------------------------------- */

export async function buildCookieValue(args: {
  userId: string;
  enrolledAtMs: number;
}): Promise<{ value: string; maxAge: number }> {
  const hours = Number(process.env.TOTP_REVERIFY_HOURS ?? 12);
  const expiresAt = Date.now() + hours * 60 * 60 * 1000;
  const payload = `${VERSION}.${args.userId}.${args.enrolledAtMs}.${expiresAt}`;
  const hmac = await sign(payload);
  return {
    value: `${payload}.${hmac}`,
    maxAge: hours * 60 * 60,
  };
}

/**
 * Validate the cookie. Returns true ONLY when:
 *   - format is v2
 *   - userId matches expected
 *   - enrolledAtMs matches expected (i.e. user hasn't re-enrolled or
 *     been reset by an admin)
 *   - expiry is in the future
 *   - HMAC verifies
 *
 * Never throws. Malformed → false.
 */
export async function validateCookieValue(args: {
  cookieValue: string | undefined;
  expectedUserId: string;
  expectedEnrolledAtMs: number | null;
}): Promise<boolean> {
  try {
    if (!args.cookieValue) return false;
    const parts = args.cookieValue.split(".");
    // v2 format = 5 parts (v2, userId, enrolledAtMs, expiresAtMs, hmac)
    if (parts.length !== 5) return false;
    const [version, userId, enrolledAtStr, expiresAtStr, hmac] = parts;
    if (version !== VERSION) return false;
    if (userId !== args.expectedUserId) return false;
    if (args.expectedEnrolledAtMs === null) return false; // user is no longer enrolled
    if (Number(enrolledAtStr) !== args.expectedEnrolledAtMs) return false;

    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

    const payload = `${version}.${userId}.${enrolledAtStr}.${expiresAtStr}`;
    return await verifySig(payload, hmac);
  } catch {
    return false;
  }
}

export const TWOFA_COOKIE_NAME = COOKIE_NAME;
