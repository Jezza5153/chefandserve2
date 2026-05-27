/**
 * 2FA verification cookie — PR-S2B.
 *
 * Auth.js issues the JWT session normally on magic-link callback. To gate
 * /admin/* on a second factor for internal users we use a separate signed
 * HttpOnly cookie, decoupled from the session.
 *
 * Cookie name:  cs_2fa_verified
 * Cookie value: `${userId}.${expiresAtEpochMs}.${hmac}`
 *   where hmac = hmac_sha256(TOTP_ENCRYPTION_KEY, `${userId}.${expiresAtEpochMs}`)
 *
 * Web Crypto API (SubtleCrypto) used throughout so this module is safe in
 * both Node runtime (server actions) and Edge runtime (middleware).
 *
 * Properties:
 *   - HttpOnly, Secure (prod), SameSite=Lax, Path=/
 *   - TTL = TOTP_REVERIFY_HOURS (default 12)
 *   - Tied to userId — the verify path always compares against the current
 *     session.user.id, so a swiped cookie cannot be moved between users.
 */

const COOKIE_NAME = "cs_2fa_verified";

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
  const dataBuf = new TextEncoder().encode(payload).slice().buffer;
  const sig = await crypto.subtle.sign("HMAC", key, dataBuf);
  return toHex(sig);
}

async function verify(payload: string, expectedHex: string): Promise<boolean> {
  const expected = fromHex(expectedHex);
  if (!expected) return false;
  const key = await getKey();
  // Copy to a fresh ArrayBuffer so TS doesn't flag ArrayBufferLike (possibly
  // SharedArrayBuffer) — crypto.subtle.verify wants BufferSource over plain
  // ArrayBuffer in strict mode.
  const sigBuf = expected.slice().buffer;
  const dataBuf = new TextEncoder().encode(payload).slice().buffer;
  return crypto.subtle.verify("HMAC", key, sigBuf, dataBuf);
}

/* ---------- public API ----------------------------------------------- */

export async function buildCookieValue(userId: string): Promise<{
  value: string;
  maxAge: number;
}> {
  const hours = Number(process.env.TOTP_REVERIFY_HOURS ?? 12);
  const expiresAt = Date.now() + hours * 60 * 60 * 1000;
  const hmac = await sign(`${userId}.${expiresAt}`);
  return {
    value: `${userId}.${expiresAt}.${hmac}`,
    maxAge: hours * 60 * 60,
  };
}

/**
 * Validate a cookie value against an expected userId. Returns true only when
 * the HMAC is valid, the cookie userId matches, and the cookie hasn't
 * expired.
 */
export async function validateCookieValue(args: {
  cookieValue: string | undefined;
  expectedUserId: string;
}): Promise<boolean> {
  if (!args.cookieValue) return false;
  const parts = args.cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [userId, expiresAtStr, hmac] = parts;
  if (userId !== args.expectedUserId) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return verify(`${userId}.${expiresAt}`, hmac);
}

export const TWOFA_COOKIE_NAME = COOKIE_NAME;
