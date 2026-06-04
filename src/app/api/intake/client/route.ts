import { handleJotformWebhook } from "@/lib/intake/handler";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";

/**
 * Jotform webhook receiver — client intake (LEGACY, being retired).
 *
 * The public klant CTAs now point at the native /horeca-personeel-aanvragen
 * form, so this endpoint should receive ~no traffic. Kept during the transition
 * window with a per-IP rate limit to cap injection/DoS abuse; decommission once
 * the Jotform form is disabled.
 *
 * Production URL: https://chefandserve2.vercel.app/api/intake/client
 */
export async function POST(request: Request): Promise<Response> {
  // Fail-open: a misconfigured limiter must never drop a legitimate webhook.
  try {
    const rl = await checkRateLimit("intake_webhook_ip", extractClientIp(request.headers));
    if (!rl.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  } catch (e) {
    console.error("[intake/client] rate-limit check failed (fail-open):", e);
  }
  return handleJotformWebhook(request, "client");
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: "intake/client",
    method: "POST a Jotform webhook payload to this URL",
  });
}
