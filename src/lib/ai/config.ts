/**
 * Runtime configuration accessors for the owner AI assistant. Centralizes the env
 * reads so the rest of the AI code never touches `process.env` directly, and so the
 * "switch it on" surface is a single, obvious file.
 */
import { env } from "@/lib/env";

/** Master switch — true once the assistant surfaces are live. */
export function aiEnabled(): boolean {
  return env.AI_ENABLED === "true";
}

/** True once a model key is present (the gate before any LLM call or embedding job). */
export function aiHasModelKey(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * Chef-facing AI chat (portal AssistantWidget). DEFAULT OFF — chefs get AI help
 * only indirectly (CV-driven profile suggestions + completeness nudges). Gated
 * separately from aiEnabled() so the owner/klant assistant surfaces stay live.
 */
export function chefAiChatEnabled(): boolean {
  return env.CHEF_AI_CHAT_ENABLED === "true";
}

/** CV-driven profile enrichment (chefs.enrich_from_cv tool + nightly sweep). Default off. */
export function cvProfilingEnabled(): boolean {
  return env.CV_AI_PROFILING_ENABLED === "true";
}

/** The model id used for the chat/agent brain. Embeddings use OPENAI_API_KEY directly. */
export function aiModel(): string {
  return env.OPENAI_MODEL ?? "gpt-4o";
}

export type AiPrice = { inputPer1M: number; outputPer1M: number; currency: string };

/**
 * Built-in per-1M-token rates (USD) for the models we run, from the OpenAI pricing docs.
 * STANDARD (uncached) input rate; OpenAI prompt-caching makes the real bill a bit lower, so
 * the card's cost is a slight upper bound. Update here if OpenAI changes pricing, or override
 * per-account with OPENAI_PRICE_*_PER_1M.
 *   gpt-5.4: $2.50 in / $15.00 out (cached input $0.25) — developers.openai.com, 2026-06.
 */
const MODEL_PRICING: Record<string, AiPrice> = {
  "gpt-5.4": { inputPer1M: 2.5, outputPer1M: 15, currency: "USD" },
};

/**
 * Prices for the active model. Env (OPENAI_PRICE_*_PER_1M, optional currency) wins so an
 * account-specific or EUR rate can override; else the built-in rate for the model id; null
 * if neither is known (the AI-tokens card then shows tokens only, no cost).
 */
export function aiPricing(): AiPrice | null {
  const inputPer1M = env.OPENAI_PRICE_INPUT_PER_1M;
  const outputPer1M = env.OPENAI_PRICE_OUTPUT_PER_1M;
  if (inputPer1M != null && outputPer1M != null) {
    return { inputPer1M, outputPer1M, currency: env.OPENAI_PRICE_CURRENCY ?? "USD" };
  }
  return MODEL_PRICING[aiModel()] ?? null;
}

/**
 * The HMAC secret that signs action-confirmation tokens. Throws at call time if unset
 * (mirrors RATE_LIMIT_HASH_SECRET / TOTP_ENCRYPTION_KEY): confirm-gated tools must never
 * silently run without a verifiable human "yes".
 */
export function aiConfirmSecret(): string {
  const secret = env.AI_CONFIRM_SECRET;
  if (!secret) {
    throw new Error(
      "AI_CONFIRM_SECRET is not set — required to mint/verify AI action-confirmation tokens.",
    );
  }
  return secret;
}
