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

  // Vercel injects this automatically; defaulted for local dev
  VERCEL_ENV: z.enum(["development", "preview", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

/* ----------------------------- parse ------------------------------------ */

/**
 * The client-safe slice is collected explicitly: only keys listed here are
 * exposed via `env.*` to client components. This prevents accidental leaks.
 */
const processClientEnv = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

/* ----------------------------- runtime parse logic ---------------------- */

const isServer = typeof window === "undefined";
const isBuildTime = process.env.NEXT_PHASE === "phase-production-build";

let parsed: z.infer<typeof clientSchema> & Partial<z.infer<typeof serverSchema>>;

if (isServer) {
  // Server-side: validate both halves. Fail loudly.
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

    // At build time, throw to fail the build cleanly.
    // At runtime, throw to crash the route so the error is visible.
    throw new Error(
      `\n[chef-and-serve] Invalid environment variables.\n${issues.join("\n")}\n\n` +
        `Tip: copy .env.example to .env.local and fill in the missing values, ` +
        `or set them in Vercel project Settings → Environment Variables.\n`,
    );
  }

  parsed = { ...serverResult.data, ...clientResult.data };
} else {
  // Client-side: only validate NEXT_PUBLIC_* keys. Server keys are not
  // available in process.env on the client (Next.js strips them).
  const clientResult = clientSchema.safeParse(processClientEnv);
  if (!clientResult.success) {
    throw new Error(
      `[chef-and-serve] Missing public env: ${clientResult.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  }
  parsed = clientResult.data;
}

// Build-time guard: surface what we know without throwing during static analysis
if (isBuildTime && !isServer) {
  // no-op — build prerender only runs server-side
}

/**
 * Validated environment access. Use `env.X` everywhere instead of
 * `process.env.X` so missing keys are caught at startup, not request time.
 */
export const env = parsed;

/** Convenience flag — true when running under Vercel's production env. */
export const isProduction = process.env.VERCEL_ENV === "production";
