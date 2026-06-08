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

/** The model id used for the chat/agent brain. Embeddings use OPENAI_API_KEY directly. */
export function aiModel(): string {
  return env.OPENAI_MODEL ?? "gpt-4o";
}

/**
 * Per-1M-token prices (EUR) for the active model, or null when not configured. BOTH
 * OPENAI_PRICE_INPUT_PER_1M and _OUTPUT_PER_1M must be set; otherwise the AI-tokens card
 * shows tokens only (we never guess a model's rate).
 */
export function aiPricing(): { inputPer1M: number; outputPer1M: number } | null {
  const inputPer1M = env.OPENAI_PRICE_INPUT_PER_1M;
  const outputPer1M = env.OPENAI_PRICE_OUTPUT_PER_1M;
  if (inputPer1M == null || outputPer1M == null) return null;
  return { inputPer1M, outputPer1M };
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
