/**
 * POST /api/ai/portal/chat — the chat channel for the CHEF + KLANT portal assistants.
 *
 * Stateless (full history per turn). Gated by `session.user.kind`: a chef gets the chef
 * assistant, a klant the klant assistant — each scoped to ONLY their own data (the tools key
 * off the resolved subject, never a model-supplied id). Read-only V1. Dormant unless
 * AI_ENABLED=true + a model key is set. Rate-limited like the owner channel.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiConfirmSecret, aiEnabled, aiModel } from "@/lib/ai/config";
import { createOpenAiBrain } from "@/lib/ai/runtime/openai-brain";
import { CHEF_SYSTEM_PROMPT, CLIENT_SYSTEM_PROMPT } from "@/lib/ai/runtime/portal-prompts";
import { runChefAssistant, runClientAssistant } from "@/lib/ai/runtime/assistant";
import { recordAiUsage } from "@/lib/ai/read-model/ai-usage";
import type { Msg } from "@/lib/ai/runtime/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const kind = session.user.kind;
  if (kind !== "chef" && kind !== "client") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const rl = await checkRateLimit("ai_chat_user", session.user.id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Even rustig aan — te veel verzoeken achter elkaar. Probeer het over ${rl.retryAfterSec}s opnieuw.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
  } catch {
    // limiter unavailable → allow
  }

  if (!aiEnabled() || !env.OPENAI_API_KEY) {
    return NextResponse.json({ disabled: true, message: "De assistent staat nog uit." });
  }

  let confirmSecret: string;
  try {
    confirmSecret = aiConfirmSecret();
  } catch {
    return NextResponse.json({ error: "AI_CONFIRM_SECRET ontbreekt." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const messages = (body as { messages?: Msg[] }).messages ?? [];

  let promptTokens = 0;
  let completionTokens = 0;
  const onUsage = (u: { promptTokens: number; completionTokens: number }) => {
    promptTokens += u.promptTokens;
    completionTokens += u.completionTokens;
  };

  try {
    const systemPrompt = kind === "chef" ? CHEF_SYSTEM_PROMPT : CLIENT_SYSTEM_PROMPT;
    const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel(), systemPrompt, onUsage });
    const run = { userId: session.user.id, channel: "dashboard" as const, messages, brain, confirmSecret };
    const outcome = kind === "chef" ? await runChefAssistant(run) : await runClientAssistant(run);
    if (outcome === null) {
      const what = kind === "chef" ? "chef-profiel" : "klant-profiel";
      return NextResponse.json({
        outcome: {
          kind: "final",
          text: `Er is nog geen ${what} aan je account gekoppeld. Neem contact op met het kantoor.`,
          steps: [],
        },
      });
    }
    if (promptTokens > 0 || completionTokens > 0) {
      try {
        await recordAiUsage({ model: aiModel(), promptTokens, completionTokens, now: new Date() });
      } catch (e) {
        console.error("[ai/portal/chat] usage tally failed:", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: `De assistent liep vast: ${message}` }, { status: 502 });
  }
}
