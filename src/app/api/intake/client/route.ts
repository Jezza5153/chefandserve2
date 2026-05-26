import { handleJotformWebhook } from "@/lib/intake/handler";

/**
 * Jotform webhook receiver — client intake.
 *
 * Wire this URL into Jotform form 252448184762060 → Settings → Integrations → Webhooks.
 * Production URL: https://chefandserve2.vercel.app/api/intake/client
 */
export async function POST(request: Request): Promise<Response> {
  return handleJotformWebhook(request, "client");
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: "intake/client",
    method: "POST a Jotform webhook payload to this URL",
  });
}
