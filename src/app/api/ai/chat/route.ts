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
import { timeContextBlock } from "@/lib/ai/runtime/time-context";
import { checkAiBudget, maybeNotifyAiBudget, recordAiUsage } from "@/lib/ai/read-model/ai-usage";
import { breakerOpen, recordAiFailure, recordAiSuccess } from "@/lib/ai/circuit-breaker";
import { buildShortlistEnvelope } from "@/lib/shortlist-envelope";
import type { Msg } from "@/lib/ai/runtime/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  // Planners join behind PLANNER_AI_ENABLED (wave B1): the executor's per-tool RBAC ceiling +
  // the scoped registry (assistant.ts) are the real walls — this gate is access policy.
  const isPlanner =
    process.env.PLANNER_AI_ENABLED === "true" && hasRole(session, "planner");
  if (!hasRole(session, "owner", "super_admin") && !isPlanner) {
    return new NextResponse("Forbidden", { status: 403 });
  }

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

  // Daily budget ceiling (audit fix: spend was tracked but never BLOCKED). Best-effort warn at
  // ≥80% (throttled), hard decline at 100% — usage resets at the next UTC day.
  try {
    const budget = await checkAiBudget(new Date());
    void maybeNotifyAiBudget(budget).catch(() => {});
    if (budget.limited && budget.spent != null && budget.limit != null) {
      return NextResponse.json({
        outcome: {
          kind: "final",
          text: `Het AI-dagbudget is bereikt (${budget.currency} ${budget.spent.toFixed(2)} van ${budget.currency} ${budget.limit.toFixed(2)}). Morgen sta ik weer klaar — of verhoog AI_DAILY_BUDGET.`,
          steps: [],
        },
      });
    }
  } catch {
    // budget check unavailable → fail open (never block the assistant on a tally hiccup)
  }

  // Circuit breaker: after repeated provider failures we pause a few minutes instead of
  // hammering OpenAI with every chat turn. Fails open.
  if (await breakerOpen()) {
    return NextResponse.json({
      outcome: {
        kind: "final",
        text: "De AI-provider had net een paar storingen achter elkaar — ik pauzeer een paar minuten en ben daarna vanzelf weer terug. Probeer het zo opnieuw.",
        steps: [],
      },
    });
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
  // Keep timeBlock + pageBlock + memoryBlock OUT of the brain's system prompt: they're DYNAMIC
  // (time every minute, page on every nav, memory on edit) and folding them into the prefix defeats
  // OpenAI prompt caching. Pass them as a TRAILING context message instead, so the static prefix
  // (system prompt + tool defs) stays byte-stable across turns/pages and caches at ~10× cheaper input.
  const plannerBlock = isPlanner
    ? "\n\nJe praat met een PLANNER (geen eigenaar): focus op diensten vullen, voorstellen en bevestigen. Financiële informatie, klantwaarde en uren-goedkeuring horen niet bij deze rol — verwijs daarvoor naar Maarten."
    : "";
  const systemContext = `${timeContextBlock()}${plannerBlock}${pageBlock}${memoryBlock}`.trim() || undefined;
  // Accumulate token usage across the turn's model calls; persisted after the run for the
  // /admin/system AI-tokens card. A tally failure never breaks the chat (try/catch below).
  let promptTokens = 0;
  let completionTokens = 0;
  const brain = createOpenAiBrain({
    apiKey: env.OPENAI_API_KEY,
    model: aiModel(),
    systemPrompt: DEFAULT_SYSTEM_PROMPT, // static → cacheable prefix; dynamic context rides trailing
    promptCacheKey: `${isPlanner ? "planner" : "owner"}:${userId}`, // planner prefix differs (scoped tool defs)
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
    // Provider failure → count it for the breaker and try the fallback model ONCE (if set);
    // a healthy run resets the breaker. Tool errors don't throw here (the executor returns
    // them to the model) — only provider/loop-level failures land in this catch.
    const runWith = (b: typeof brain) =>
      runOwnerAssistant({ userId, channel: "dashboard", messages, brain: b, confirmSecret, systemContext });
    let outcome: Awaited<ReturnType<typeof runWith>>;
    try {
      outcome = await runWith(brain);
      void recordAiSuccess();
    } catch (err) {
      void recordAiFailure();
      if (!env.OPENAI_FALLBACK_MODEL) throw err;
      const fallbackBrain = createOpenAiBrain({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_FALLBACK_MODEL,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        promptCacheKey: `owner-fb:${userId}`,
        maxCompletionTokens: 2000,
        onUsage: (u) => {
          promptTokens += u.promptTokens;
          completionTokens += u.completionTokens;
        },
      });
      outcome = await runWith(fallbackBrain); // a second failure falls through to the outer catch
      void recordAiSuccess();
    }
    if (promptTokens > 0 || completionTokens > 0) {
      try {
        await recordAiUsage({ model: aiModel(), promptTokens, completionTokens, now: new Date() });
      } catch (e) {
        console.error("[ai/chat] usage tally failed:", e instanceof Error ? e.message : e);
      }
    }
    // P5a-2 (dark): when the assistant produced a shifts.suggest_chefs shortlist, hand the
    // owner a minimal, AVG-safe action envelope so the chat can render "Stel voor" buttons.
    // Off / no shortlist → response is unchanged (text-only).
    const shortlist =
      outcome.kind === "final" && env.AI_SHORTLIST_ACTIONS_ENABLED === "true"
        ? buildShortlistEnvelope(outcome.steps)
        : null;
    return NextResponse.json(shortlist ? { outcome, shortlist } : { outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: `De assistent liep vast: ${message}` }, { status: 502 });
  }
}
