/**
 * POST /api/ai/chat — the dashboard channel for the owner assistant.
 *
 * Stateless: the client sends the full message history each turn (or a `confirm`
 * payload to execute a pending action). Owner / super_admin only. Dormant unless
 * AI_ENABLED=true + a model key is set.
 *
 * Body:
 *   { messages: Msg[] }                                  → run the agent
 *   { confirm: { tool, input, token } }                  → execute a confirmed action
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { env } from "@/lib/env";
import { aiConfirmSecret, aiEnabled, aiModel } from "@/lib/ai/config";
import { createOpenAiBrain } from "@/lib/ai/runtime/openai-brain";
import { confirmOwnerAction, runOwnerAssistant } from "@/lib/ai/runtime/assistant";
import type { Msg } from "@/lib/ai/runtime/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasRole(session, "owner", "super_admin")) return new NextResponse("Forbidden", { status: 403 });

  if (!aiEnabled() || !env.OPENAI_API_KEY) {
    return NextResponse.json({
      disabled: true,
      message: "De assistent staat nog uit. Zet AI_ENABLED=true en OPENAI_API_KEY om hem te activeren.",
    });
  }

  let confirmSecret: string;
  try {
    confirmSecret = aiConfirmSecret();
  } catch {
    return NextResponse.json({ error: "AI_CONFIRM_SECRET ontbreekt — kan acties niet veilig bevestigen." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const userId = session.user.id;
  const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });

  try {
    const confirm = (body as { confirm?: { tool: string; input: unknown; token: string } }).confirm;
    if (confirm) {
      const result = await confirmOwnerAction({
        userId,
        channel: "dashboard",
        tool: confirm.tool,
        input: confirm.input,
        token: confirm.token,
        confirmSecret,
      });
      return NextResponse.json({ result });
    }

    const messages = (body as { messages?: Msg[] }).messages ?? [];
    const outcome = await runOwnerAssistant({ userId, channel: "dashboard", messages, brain, confirmSecret });
    return NextResponse.json({ outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: `De assistent liep vast: ${message}` }, { status: 502 });
  }
}
