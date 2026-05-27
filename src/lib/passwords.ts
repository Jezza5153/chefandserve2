/**
 * Passwords — bcrypt hashing + haveibeenpwned k-anonymity breach check.
 *
 * PR-S2D. Used by the setup wizard (set password) and PR-S2E (verify
 * password on /login).
 *
 * Policy: minimum 12 characters. Any chars. Block known-breached
 * passwords (NIST 2017+ guidance: length > complexity, plus refuse
 * commonly-cracked passwords).
 *
 * Breached-check (HIBP Pwned Passwords v2):
 *   - sha1 the password client-side (well, server-side here)
 *   - send the first 5 hex chars of the hash to https://api.pwnedpasswords.com/range/{prefix}
 *   - HIBP returns a list of suffixes seen in breaches with their counts
 *   - we match against the suffix locally — the full password never leaves
 *     this server, only a 5-char hash prefix
 *
 * If the HIBP API is unreachable in production we FAIL-OPEN (allow the
 * password but log a warning). Better than blocking enrollment because
 * of a third-party outage.
 */

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;
const MIN_LENGTH = 12;
const HIBP_API_URL = "https://api.pwnedpasswords.com/range/";

export type PasswordCheckResult =
  | { ok: true }
  | { ok: false; reason: "too-short" | "breached" | "empty"; details?: string };

/** Local-only policy check (length, non-empty). */
export function checkPolicy(password: string): PasswordCheckResult {
  if (!password) return { ok: false, reason: "empty" };
  if (password.length < MIN_LENGTH) {
    return {
      ok: false,
      reason: "too-short",
      details: `Wachtwoord moet minimaal ${MIN_LENGTH} tekens lang zijn.`,
    };
  }
  return { ok: true };
}

/**
 * Check the password against HIBP's k-anonymity API. Returns the breach
 * count (0 = not breached). Fail-open on network errors — log + return 0.
 */
// Web Crypto API SHA1 — works in both Node and Edge runtimes.
async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", data);
  const view = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out.toUpperCase();
}

export async function checkBreached(password: string): Promise<number> {
  if (!password) return 0;
  const sha1 = await sha1Hex(password);
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const r = await fetch(`${HIBP_API_URL}${prefix}`, {
      headers: { "Add-Padding": "true" }, // HIBP padding obscures real-suffix vs noise
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return 0; // fail-open
    const text = await r.text();
    for (const line of text.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix && hashSuffix.toUpperCase() === suffix) {
        return Number(count) || 1;
      }
    }
    return 0;
  } catch {
    // Fail-open: network blip or HIBP down should not block enrollment.
    return 0;
  }
}

/** Full validate: policy + breach check. */
export async function validatePassword(
  password: string,
): Promise<PasswordCheckResult> {
  const policy = checkPolicy(password);
  if (!policy.ok) return policy;

  const breached = await checkBreached(password);
  if (breached > 0) {
    return {
      ok: false,
      reason: "breached",
      details: `Dit wachtwoord komt ${breached.toLocaleString("nl-NL")} keer voor in bekende datalekken. Kies een uniek wachtwoord.`,
    };
  }
  return { ok: true };
}

/* ---------- hashing ----------------------------------------------- */

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = MIN_LENGTH;
