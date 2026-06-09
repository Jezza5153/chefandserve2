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
import { checkRateLimit } from "@/lib/rate-limit";
import { aiConfirmSecret, aiEnabled, aiModel } from "@/lib/ai/config";
import { createOpenAiBrain, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/runtime/openai-brain";
import { confirmOwnerAction, runOwnerAssistant } from "@/lib/ai/runtime/assistant";
import { ownerMemoryPromptBlock } from "@/lib/ai/read-model/owner-memory";
import { recordAiUsage } from "@/lib/ai/read-model/ai-usage";
import type { Msg } from "@/lib/ai/runtime/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasRole(session, "owner", "super_admin")) return new NextResponse("Forbidden", { status: 403 });

  // Per-user rate limit — every request can trigger paid OpenAI calls. Fail OPEN if the
  // limiter backend is unavailable/unconfigured, so it never breaks the assistant itself.
  try {
    const rl = await checkRateLimit("ai_chat_user", session.user.id);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Even rustig aan — te veel verzoeken achter elkaar. Probeer het over ${rl.retryAfterSec}s opnieuw.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
  } catch {
    // limiter unavailable → allow the request
  }

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
  // Page-aware: the dashboard widget tells us which /admin page the owner is on, so
  // "deze chef / dit / hier" resolves to what's on screen. Owner-supplied, so sanitized:
  // only a clean /admin path (no whitespace/quotes/newlines) is accepted, and capped.
  const rawPath = (body as { context?: { path?: unknown } }).context?.path;
  const pagePath =
    typeof rawPath === "string" && /^\/admin[\w/.[\]-]*$/.test(rawPath) ? rawPath.slice(0, 200) : null;
  const pageBlock = pagePath
    ? `\n\nContext: Maarten kijkt nu naar de pagina "${pagePath}". Verwijst hij naar "deze/dit/hier" zonder verdere details, gebruik dan deze pagina als context. Haal de bijbehorende gegevens altijd via een tool op.`
    : "";
  // Inject what Maarten has had the assistant remember (memory.remember), so it uses it automatically.
  const memoryBlock = await ownerMemoryPromptBlock(userId);
  // Keep pageBlock + memoryBlock OUT of the brain's system prompt: they're DYNAMIC (page changes on
  // every nav, memory on edit) and folding them into the prefix defeats OpenAI prompt caching. Pass
  // them as a TRAILING context message instead, so the static prefix (system prompt + tool defs)
  // stays byte-stable across turns/pages and caches at ~10× cheaper input.
  const systemContext = `${pageBlock}${memoryBlock}`.trim() || undefined;
  // Accumulate token usage across the turn's model calls; persisted after the run for the
  // /admin/system AI-tokens card. A tally failure never breaks the chat (try/catch below).
  let promptTokens = 0;
  let completionTokens = 0;
  const brain = createOpenAiBrain({
    apiKey: env.OPENAI_API_KEY,
    model: aiModel(),
    systemPrompt: DEFAULT_SYSTEM_PROMPT, // static → cacheable prefix; dynamic context rides trailing
    promptCacheKey: `owner:${userId}`,
    maxCompletionTokens: 2000,
    onUsage: (u) => {
      promptTokens += u.promptTokens;
      completionTokens += u.completionTokens;
    },
  });

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
    const outcome = await runOwnerAssistant({ userId, channel: "dashboard", messages, brain, confirmSecret, systemContext });
    if (promptTokens > 0 || completionTokens > 0) {
      try {
        await recordAiUsage({ model: aiModel(), promptTokens, completionTokens, now: new Date() });
      } catch (e) {
        console.error("[ai/chat] usage tally failed:", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: `De assistent liep vast: ${message}` }, { status: 502 });
  }
}
