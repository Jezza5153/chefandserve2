/**
 * Environment-variable validation (zod).
 *
 * Why: missing config = subtle production failures. We want loud crashes at
 * build/start time instead of mysterious 500s at request time.
 *
 * Two schemas:
 *   - serverEnv: secrets, never exposed to the browser.
 *   - clientEnv: `NEXT_PUBLIC_*` keys safe to ship to the browser.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const url = env.NEXT_PUBLIC_APP_URL;       // works on client + server
 *   const dsn = env.DATABASE_URL;              // server only — never read in a "use client" file
 *
 * Safety: server keys parsed via `serverSchema.parse(process.env)` at module
 * load. Next.js's webpack tree-shakes `serverEnv.*` references out of the
 * client bundle. Importing this file in a client component is fine — only
 * the client keys leak into the client chunk.
 */

import { z } from "zod";

/* ----------------------------- schemas ---------------------------------- */

const serverSchema = z.object({
  // Auth.js v5
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 chars (generate via openssl rand -base64 32)"),
  AUTH_URL: z.string().url(),

  // Neon Postgres — pooled for runtime queries, unpooled for migrations
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith("postgres"), {
      message: "DATABASE_URL must be a Postgres connection string",
    }),
  DATABASE_URL_UNPOOLED: z
    .string()
    .url()
    .refine((v) => v.startsWith("postgres"), {
      message: "DATABASE_URL_UNPOOLED must be a Postgres connection string",
    }),

  // Resend — outbound transactional email
  RESEND_API_KEY: z
    .string()
    .startsWith("re_", "RESEND_API_KEY should start with 're_'"),
  RESEND_FROM_EMAIL: z.string().email(),

  // Seed users (Phase 0). Placeholders for Maarten/Gina until real emails set.
  JEZZA_EMAIL: z.string().email(),
  MAARTEN_EMAIL: z.string().email(),
  GINA_EMAIL: z.string().email(),

  // Cloudflare R2 — file uploads. Optional until R2 is wired up.
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Phase 9 — embedding API. Optional until Phase 9 ships.
  OPENAI_API_KEY: z.string().startsWith("sk-").optional(),

  // Owner AI assistant runtime. All optional until the assistant is switched on.
  //   AI_ENABLED        — master switch for the assistant surfaces (dashboard/WhatsApp/voice).
  //   AI_CONFIRM_SECRET — HMAC key that signs action-confirmation tokens; the executor
  //                       throws at call time if a confirm-gated tool runs without it.
  //   OPENAI_MODEL      — owner chat/agent model id (e.g. gpt-4o); embeddings use OPENAI_API_KEY above.
  //   OPENAI_PORTAL_MODEL — model for the chef/klant portal assistants (4-6 tools each). Set to a
  //                       cheaper tier (e.g. gpt-5.4-mini); unset → falls back to OPENAI_MODEL.
  AI_ENABLED: z.enum(["true", "false"]).optional(),
  AI_CONFIRM_SECRET: z
    .string()
    .min(32, "AI_CONFIRM_SECRET must be ≥32 chars (openssl rand -base64 32)")
    .optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_PORTAL_MODEL: z.string().optional(),
  //   OPENAI_PRICE_INPUT_PER_1M / _OUTPUT_PER_1M — kosten per 1M tokens (EUR) voor het
  //   actieve model. Beide gezet → de AI-tokenkaart toont echte kosten; leeg → alleen tokens.
  OPENAI_PRICE_INPUT_PER_1M: z.coerce.number().nonnegative().optional(),
  OPENAI_PRICE_OUTPUT_PER_1M: z.coerce.number().nonnegative().optional(),
  //   OPENAI_PRICE_CURRENCY — display currency for the env-set prices (default USD).
  OPENAI_PRICE_CURRENCY: z.string().optional(),
  //   OPENAI_FALLBACK_MODEL — when the primary model errors after retries, the chat routes try
  //   this model ONCE before giving up (e.g. a cheaper/older model). Unset → no fallback.
  OPENAI_FALLBACK_MODEL: z.string().optional(),
  //   AI_DAILY_BUDGET — hard daily ceiling for assistant spend (all chat surfaces), in the
  //   configured price currency. Needs OPENAI_PRICE_* to compute cost; unset (or prices
  //   unset) → no ceiling. At ≥80% the owner gets a warning notification (throttled); at
  //   100% the assistant declines new turns until the next day.
  AI_DAILY_BUDGET: z.coerce.number().positive().optional(),
  //   CRON_SECRET — bearer secret Vercel Cron sends as `Authorization: Bearer <secret>`.
  //   Gates /api/cron/* (e.g. the nightly RAG re-index). Missing → the cron routes
  //   refuse to run (so they can't be triggered publicly).
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be ≥16 chars").optional(),

  // sent.dm — WhatsApp/SMS SEND provider (messaging/notifications, NOT an AI channel).
  //   SENT_DM_API_KEY  — secret, sent as the `x-api-key` header. Missing → sendWhatsApp() no-ops.
  //   SENT_DM_BASE_URL — override the API base (default https://api.sent.dm).
  // NB: sending requires a pre-approved WhatsApp template (Meta rule); we send template+params.
  SENT_DM_API_KEY: z.string().optional(),
  SENT_DM_BASE_URL: z.string().url().optional(),

  // Phase 1 PR-S1A — rate-limit key derivation secret.
  // hmac_sha256(SECRET, scope+":"+identifier) becomes the row primary key.
  // Optional during the deploy window where the env var hasn't been set yet;
  // src/lib/rate-limit.ts throws clearly if it's missing AT CALL TIME.
  RATE_LIMIT_HASH_SECRET: z
    .string()
    .min(32, "RATE_LIMIT_HASH_SECRET must be ≥32 chars (openssl rand -base64 32)")
    .optional(),

  // Phase 1 PR-S1B — Cloudflare Turnstile (anti-bot challenge on /login).
  // BOTH must be set together for Turnstile verification to activate.
  // Missing → graceful degradation: login still works, rate-limit only.
  // TURNSTILE_BYPASS=1 is preview-only escape hatch — rejected in production.
  TURNSTILE_SECRET: z.string().optional(),
  TURNSTILE_BYPASS: z.string().optional(),

  // Phase 1 PR-S2A — TOTP secret-encryption key.
  // 32-byte base64. Decrypts users.totp_secret_encrypted via AES-256-GCM.
  // Optional during the deploy window; src/lib/totp.ts throws at call time
  // if 2FA features are used without it being set.
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(32, "TOTP_ENCRYPTION_KEY must be ≥32 chars (openssl rand -base64 32)")
    .optional(),

  // PR-FB-0 — onboarding/payroll PII secret-encryption key.
  // 32-byte base64. Encrypts special-category PII at rest (chefs.bsn_encrypted /
  // iban_encrypted / id_number_encrypted) via AES-256-GCM (src/lib/crypto.ts).
  // Separate from TOTP_ENCRYPTION_KEY so the two keys rotate independently.
  // Optional during the deploy window; src/lib/crypto.ts throws at call time if a
  // PII field is encrypted/decrypted without it being set.
  PII_ENCRYPTION_KEY: z
    .string()
    .min(32, "PII_ENCRYPTION_KEY must be ≥32 chars (openssl rand -base64 32)")
    .optional(),

  // Phase 1 PR-S2B — challenge gate switch.
  //   false (default) → challenge code ships but is INACTIVE.
  //   true            → internal users with totp_enabled=true MUST clear
  //                     /verify-2fa before reaching /admin/*.
  // Documented runbook: SQL escape hatch via Neon dashboard if a super_admin
  // locks themselves out. See plan PR-S2C.
  TOTP_ENFORCE: z.enum(["true", "false"]).default("false"),
  /** Hours before a 2FA verification expires and the user must re-verify. */
  TOTP_REVERIFY_HOURS: z.coerce.number().int().positive().default(12),

  // PR-REM-1 — reminders worker dark-launch flag (the Railway worker reads this).
  // Default off; flip to 'true' once Maarten's first rule is verified.
  REMINDERS_ENABLED: z.enum(["true", "false"]).optional(),

  // KPI-5 — forecast/projection panel dark-launch flag. Default off; the insights
  // page stays correct when unset (forecastEnabled() gates only the projection block).
  KPI_FORECAST_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-1 — chef-facing AI chat (the portal AssistantWidget). DEFAULT OFF by
  // owner decision: chefs get AI help only INDIRECTLY (CV suggestions +
  // completeness nudges + push), never via a chat. Flip to 'true' to re-enable.
  CHEF_AI_CHAT_ENABLED: z.enum(["true", "false"]).optional(),

  // CV-AI-1 — AI reads a chef's CV → proposes profile fields for owner review.
  // Default off; chefs.enrich_from_cv tool + nightly sweep no-op until set.
  CV_AI_PROFILING_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-14 — Web Push. All optional → the feature stays dark until the owner
  // generates a VAPID keypair (`npx web-push generate-vapid-keys`) + flips the flag.
  // VAPID_PUBLIC_KEY must equal NEXT_PUBLIC_VAPID_PUBLIC_KEY (client uses the latter).
  WEB_PUSH_ENABLED: z.enum(["true", "false"]).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // CHEF-15 — WhatsApp delivery for chef notifications (via sent.dm). Default off;
  // needs SENT_DM_API_KEY + Meta-approved templates. The high-urgency safety net.
  CHEF_WHATSAPP_ENABLED: z.enum(["true", "false"]).optional(),

  // BOARD-1 — communal board ("Prikbord"). Gates the chef-facing feed + the
  // new-post fan-out. Owner authoring is RBAC-gated regardless; default off so
  // chefs see nothing + no mass notification fires until the owner opts in.
  BOARD_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-OPEN — chefs browse open shifts + raise their hand ("vraag een dienst aan").
  // Default off; express-interest only (planner still curates the placement).
  CHEF_OPEN_SHIFTS_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-PR2 — first-qualified-wins for EMERGENCY shifts only. When on, a chef can
  // instantly claim a shift flagged is_emergency (confirmed). Default off; normal
  // shifts stay planner-curated interest-only.
  EMERGENCY_CLAIM_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-PR2 — offer lifecycle: hours a proposal stays open before it counts as
  // "verlopen" (derived). Default 24; numeric string.
  OFFER_EXPIRY_HOURS: z.string().optional(),

  // CHEF-PR2 — offer-expiry sweep: when on, the cron alerts the owner about
  // proposals that lapsed un-responded (notify-only, no status change). Default off.
  OFFER_EXPIRY_SWEEP_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-PR5 — when on, matching SOFT-scores the chef's own travel-radius + avoid
  // preferences (captured in PR-1). Default off → live planner ranking unchanged.
  MATCHING_PREFS_ENABLED: z.enum(["true", "false"]).optional(),

  // CHEF-PR3 — Aankomstzekerheid (Arrival Trust). When on, the PWA does an on-device
  // 1km arrival check in the 20 min before a shift (sends only the result, never
  // coordinates). Default off — go-live needs an AVG/DPIA sign-off.
  ARRIVAL_TRUST_ENABLED: z.enum(["true", "false"]).optional(),

  // Vercel injects this automatically; defaulted for local dev
  VERCEL_ENV: z.enum(["development", "preview", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  /** Optional — when present, the login page renders the Turnstile widget. */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  /** CHEF-14 — VAPID public key for Web Push subscribe (safe to expose). */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
});

/* ----------------------------- parse ------------------------------------ */

/**
 * The client-safe slice is collected explicitly: only keys listed here are
 * exposed via `env.*` to client components. This prevents accidental leaks.
 */
const processClientEnv = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
};

/* ----------------------------- runtime parse logic ---------------------- */

const isServer = typeof window === "undefined";

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

function parseEnv(): ServerEnv & ClientEnv {
  if (isServer) {
    const serverResult = serverSchema.safeParse(process.env);
    const clientResult = clientSchema.safeParse(processClientEnv);

    if (!serverResult.success || !clientResult.success) {
      const issues: string[] = [];
      if (!serverResult.success) {
        issues.push(
          "Server env errors:\n" +
            serverResult.error.issues
              .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
              .join("\n"),
        );
      }
      if (!clientResult.success) {
        issues.push(
          "Client env errors:\n" +
            clientResult.error.issues
              .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
              .join("\n"),
        );
      }
      throw new Error(
        `\n[chef-and-serve] Invalid environment variables.\n${issues.join("\n")}\n\n` +
          `Tip: copy .env.example to .env.local and fill in the missing values, ` +
          `or set them in Vercel project Settings → Environment Variables.\n`,
      );
    }
    return { ...serverResult.data, ...clientResult.data };
  }

  // Client-side: server keys aren't available; return only the client slice
  // cast to the wider type. Reading any server key on the client would be a
  // logical bug (the value is undefined at runtime in the browser anyway).
  const clientResult = clientSchema.safeParse(processClientEnv);
  if (!clientResult.success) {
    throw new Error(
      `[chef-and-serve] Missing public env: ${clientResult.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  }
  // Cast: client code that reads a server key is broken regardless; the value
  // would be undefined at runtime. The cast keeps server-side call sites typed.
  return clientResult.data as ServerEnv & ClientEnv;
}

/**
 * Validated environment access. Use `env.X` everywhere instead of
 * `process.env.X` so missing keys are caught at startup, not request time.
 */
export const env = parseEnv();

/** Convenience flag — true when running under Vercel's production env. */
export const isProduction = process.env.VERCEL_ENV === "production";
