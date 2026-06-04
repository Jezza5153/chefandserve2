import { handleJotformWebhook } from "@/lib/intake/handler";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";

/**
 * Jotform webhook receiver — chef intake (LEGACY, being retired).
 *
 * The public chef CTA now points at the native /sollicitatie form, so this
 * endpoint should receive ~no traffic. Kept during the transition window with a
 * per-IP rate limit to cap injection/DoS abuse; decommission once the Jotform
 * form is disabled.
 *
 * Production URL: https://chefandserve2.vercel.app/api/intake/chef
 *
 * No auth header required — Jotform itself doesn't authenticate posts. If we
 * enable JOTFORM_WEBHOOK_SECRET env var, we check x-jotform-signature.
 */
export async function POST(request: Request): Promise<Response> {
  // Fail-open: a misconfigured limiter must never drop a legitimate webhook.
  try {
    const rl = await checkRateLimit("intake_webhook_ip", extractClientIp(request.headers));
    if (!rl.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  } catch (e) {
    console.error("[intake/chef] rate-limit check failed (fail-open):", e);
  }
  return handleJotformWebhook(request, "chef");
}

/** GET → health check ("am I wired up correctly?") */
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: "intake/chef",
    method: "POST a Jotform webhook payload to this URL",
  });
}
