import { handleJotformWebhook } from "@/lib/intake/handler";

/**
 * Jotform webhook receiver — chef intake.
 *
 * Wire this URL into Jotform form 252442173847359 → Settings → Integrations → Webhooks.
 * Production URL: https://chefandserve2.vercel.app/api/intake/chef
 *
 * No auth header required — Jotform itself doesn't authenticate posts. If we
 * enable JOTFORM_WEBHOOK_SECRET env var, we check x-jotform-signature.
 */
export async function POST(request: Request): Promise<Response> {
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
