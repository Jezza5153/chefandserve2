/**
 * Cloudflare Turnstile verification — PR-S1B.
 *
 * Server-side validation is mandatory. The client widget puts a token in
 * the `cf-turnstile-response` form field; we hit Cloudflare's siteverify
 * with it plus `remoteip` and the secret.
 *
 * Token semantics:
 *   - Single-use. Cloudflare returns `timeout-or-duplicate` on replay.
 *   - 300-second lifetime.
 *   - We pass `remoteip` so Cloudflare can correlate the challenge with
 *     the originating client.
 *
 * Graceful degradation:
 *   - If env vars aren't set (TURNSTILE_SECRET + NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *     missing) → `isConfigured()` returns false. Login still works, only
 *     rate-limit gates the request. This lets the code ship before the user
 *     creates the Turnstile site at dash.cloudflare.com.
 *
 * Fail-closed:
 *   - When Turnstile IS configured AND verification fails or Cloudflare API
 *     is unreachable in production → reject. Bypass env honored only outside
 *     production.
 */

import { env, isProduction } from "@/lib/env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isConfigured(): boolean {
  return Boolean(env.TURNSTILE_SECRET && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export function bypassActive(): boolean {
  // Bypass only honored when NOT in production. Production must always verify.
  return env.TURNSTILE_BYPASS === "1" && !isProduction;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; codes: string[]; reason: "missing-token" | "verification-failed" | "api-error" };

/**
 * Verify a token. Returns `ok: true` when Turnstile says yes.
 *
 * When Turnstile is NOT configured (env vars missing): returns `ok: true`
 * — the gate isn't active yet, so it shouldn't block requests. The login
 * page still has rate-limit as a defense.
 *
 * When configured + bypass active (preview/dev only): returns `ok: true`.
 *
 * When configured + verification fails: returns `ok: false` with codes
 * from Cloudflare. The caller maps that to a generic UI error and writes
 * an error_log row.
 */
export async function verifyTurnstileToken(args: {
  token: string | null | undefined;
  remoteIp?: string;
}): Promise<VerifyResult> {
  if (!isConfigured()) {
    // Graceful — gate not yet active. Caller falls back to rate-limit only.
    return { ok: true };
  }
  if (bypassActive()) {
    return { ok: true };
  }

  const token = (args.token ?? "").trim();
  if (!token) {
    return { ok: false, codes: ["missing-input-response"], reason: "missing-token" };
  }

  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET!);
  body.set("response", token);
  if (args.remoteIp) body.set("remoteip", args.remoteIp);

  let json: { success: boolean; "error-codes"?: string[] };
  try {
    const r = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      // 5-second budget — we'd rather fail-closed than hang the login page
      signal: AbortSignal.timeout(5000),
    });
    json = (await r.json()) as typeof json;
  } catch {
    return {
      ok: false,
      codes: ["api-error"],
      reason: "api-error",
    };
  }

  if (!json.success) {
    return {
      ok: false,
      codes: json["error-codes"] ?? ["unknown"],
      reason: "verification-failed",
    };
  }

  return { ok: true };
}
