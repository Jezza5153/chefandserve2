/**
 * AI token-usage tally — measures what the owner assistant actually spends and feeds the
 * "AI-tokens" card on /admin/system. Stored in business_settings (jsonb), mirroring the
 * owner-memory / owner-reminders pattern — no migration. Bucketed per day, per model, so
 * the blob stays bounded (pruned after 120 days) and cost can be computed per model.
 *
 * Cost is only shown once per-1M-token prices are configured (OPENAI_PRICE_*_PER_1M); we
 * never fabricate a rate. Aggregation + cost math are pure + exported so they're testable
 * without a DB (scripts/smoke-ai-usage.mts).
 */
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { businessSettings, notifications, users } from "@/lib/db/schema";
import { withTx } from "@/lib/db/tx";
import { env } from "@/lib/env";
import { aiPricing } from "@/lib/ai/config";
import { createNotification } from "@/lib/integrations/notifications";

const KEY = "ai_usage";
const PRUNE_AFTER_DAYS = 120;

type ModelTally = { prompt: number; completion: number; turns: number };
/** days["2026-06-08"]["gpt-5.4"] = { prompt, completion, turns } */
export type UsageBag = { days: Record<string, Record<string, ModelTally>> };

function readBag(value: unknown): UsageBag {
  const days = (value as { days?: unknown } | null)?.days;
  if (days && typeof days === "object" && !Array.isArray(days)) {
    return { days: days as UsageBag["days"] };
  }
  return { days: {} };
}

/** yyyy-mm-dd in UTC — matches the date-only storage used elsewhere in the app. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** PURE: sum every day bucket whose key is >= fromKey (lexicographic on yyyy-mm-dd). */
export function aggregateUsage(
  bag: UsageBag,
  fromKey: string,
): { prompt: number; completion: number; turns: number; models: Set<string> } {
  let prompt = 0;
  let completion = 0;
  let turns = 0;
  const models = new Set<string>();
  for (const [k, day] of Object.entries(bag.days)) {
    if (k < fromKey) continue;
    for (const [model, t] of Object.entries(day)) {
      prompt += t.prompt;
      completion += t.completion;
      turns += t.turns;
      models.add(model);
    }
  }
  return { prompt, completion, turns, models };
}

/** PURE: cost from per-1M-token prices, or null when prices aren't configured. */
export function computeCost(
  prompt: number,
  completion: number,
  pricing: { inputPer1M: number; outputPer1M: number } | null,
): number | null {
  if (!pricing) return null;
  return (prompt / 1_000_000) * pricing.inputPer1M + (completion / 1_000_000) * pricing.outputPer1M;
}

/**
 * Add one assistant turn's usage to the tally. Best-effort: callers wrap in try/catch so a
 * tally failure never breaks the chat response. No-op on empty usage.
 */
export async function recordAiUsage(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  now: Date;
}): Promise<void> {
  if (args.promptTokens <= 0 && args.completionTokens <= 0) return;
  const key = dayKey(args.now);
  const cutoff = dayKey(new Date(args.now.getTime() - PRUNE_AFTER_DAYS * 86_400_000));
  await withTx(async (tx) => {
    const [row] = await tx
      .select({ value: businessSettings.value })
      .from(businessSettings)
      .where(eq(businessSettings.key, KEY))
      .limit(1);
    const bag = readBag(row?.value);

    const dayBucket = bag.days[key] ?? {};
    bag.days[key] = dayBucket;
    const tally = dayBucket[args.model] ?? { prompt: 0, completion: 0, turns: 0 };
    dayBucket[args.model] = tally;
    tally.prompt += args.promptTokens;
    tally.completion += args.completionTokens;
    tally.turns += 1;

    for (const k of Object.keys(bag.days)) if (k < cutoff) delete bag.days[k];

    await tx
      .insert(businessSettings)
      .values({ key: KEY, value: bag })
      .onConflictDoUpdate({
        target: businessSettings.key,
        set: { value: bag, updatedAt: new Date() },
      });
  });
}

/* ----- daily budget ceiling (audit fix: spend was tracked but never blocked) ----- */

export type AiBudgetState = {
  /** True → decline new assistant turns today. */
  limited: boolean;
  /** True → ≥80% of the ceiling but not over it (warn, still allow). */
  nearLimit: boolean;
  spent: number | null;
  limit: number | null;
  currency: string;
};

/** PURE: today's spend vs the ceiling. No limit configured (or no pricing) → never limited. */
export function budgetState(
  bag: UsageBag,
  now: Date,
  limit: number | null,
  pricing: { inputPer1M: number; outputPer1M: number; currency: string } | null,
): AiBudgetState {
  const today = bag.days[dayKey(now)] ?? {};
  let prompt = 0;
  let completion = 0;
  for (const t of Object.values(today)) {
    prompt += t.prompt;
    completion += t.completion;
  }
  const spent = computeCost(prompt, completion, pricing);
  const currency = pricing?.currency ?? "EUR";
  if (limit == null || spent == null) {
    return { limited: false, nearLimit: false, spent, limit: limit ?? null, currency };
  }
  return {
    limited: spent >= limit,
    nearLimit: spent >= 0.8 * limit && spent < limit,
    spent,
    limit,
    currency,
  };
}

/** Today's budget state from the stored tally + env (AI_DAILY_BUDGET + OPENAI_PRICE_*). */
export async function checkAiBudget(now: Date): Promise<AiBudgetState> {
  const limit = env.AI_DAILY_BUDGET ?? null;
  const pricing = aiPricing();
  if (limit == null || pricing == null) {
    return { limited: false, nearLimit: false, spent: null, limit, currency: pricing?.currency ?? "EUR" };
  }
  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, KEY))
    .limit(1);
  return budgetState(readBag(row?.value), now, limit, pricing);
}

/**
 * Warn/inform the owner when the budget is ≥80% or hit. Best-effort + throttled (max one
 * notification per 20h) so a busy day doesn't spam the bell. Callers fire-and-forget.
 */
export async function maybeNotifyAiBudget(b: AiBudgetState): Promise<void> {
  if ((!b.limited && !b.nearLimit) || b.spent == null || b.limit == null || !env.MAARTEN_EMAIL) return;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  if (!owner) return;
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, owner.id),
        eq(notifications.type, "ai_budget_alert"),
        gt(notifications.createdAt, since),
      ),
    )
    .limit(1);
  if (recent.length > 0) return;
  const fmt = (n: number) => `${b.currency} ${n.toFixed(2)}`;
  await createNotification({
    userId: owner.id,
    type: "ai_budget_alert",
    title: b.limited ? "AI-dagbudget bereikt" : "AI-dagbudget bijna bereikt",
    body: b.limited
      ? `De assistent heeft vandaag ${fmt(b.spent)} van ${fmt(b.limit)} gebruikt en pauzeert tot morgen. Verhoog AI_DAILY_BUDGET om door te gaan.`
      : `De assistent zit op ${fmt(b.spent)} van ${fmt(b.limit)} vandaag (≥80%).`,
    actionUrl: "/admin/system",
  });
}

export type AiUsageSummary = {
  windowDays: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
  models: string[];
  /** null until OPENAI_PRICE_*_PER_1M are set. */
  cost: { amount: number; currency: string } | null;
};

/** Rolling summary over the last `windowDays` (default 30), for the AI-tokens card. */
export async function getAiUsageSummary(args: { now: Date; windowDays?: number }): Promise<AiUsageSummary> {
  const windowDays = args.windowDays ?? 30;
  const fromKey = dayKey(new Date(args.now.getTime() - (windowDays - 1) * 86_400_000));
  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, KEY))
    .limit(1);
  const agg = aggregateUsage(readBag(row?.value), fromKey);
  const pricing = aiPricing();
  const amount = computeCost(agg.prompt, agg.completion, pricing);
  return {
    windowDays,
    promptTokens: agg.prompt,
    completionTokens: agg.completion,
    totalTokens: agg.prompt + agg.completion,
    turns: agg.turns,
    models: [...agg.models],
    cost: amount == null || pricing == null ? null : { amount, currency: pricing.currency },
  };
}
