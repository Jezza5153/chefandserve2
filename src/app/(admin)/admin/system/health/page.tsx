/**
 * System health page — super_admin only.
 *
 * Reads the same components as /api/health but rendered with status pills
 * + remediation hints. Use this when something feels off, before going
 * deeper into logs.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { env, isProduction } from "@/lib/env";
import { r2IsConfigured } from "@/lib/r2";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Health" };
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "missing" | "error";

type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
};

export default async function HealthPage() {
  await requirePermission("health", "read");

  // Hit the same logic the /api/health endpoint uses.
  const checks: Check[] = [];

  // Database
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - start;
    checks.push({
      name: "Database (Neon)",
      status: "ok",
      detail: `Roundtrip: ${ms} ms`,
    });
  } catch (e) {
    checks.push({
      name: "Database (Neon)",
      status: "error",
      detail: e instanceof Error ? e.message : "Unknown error",
      remediation: "Check DATABASE_URL in Vercel env, then check Neon dashboard.",
    });
  }

  // Auth secret
  checks.push({
    name: "Auth secret",
    status: env.AUTH_SECRET ? "ok" : "missing",
    detail: env.AUTH_SECRET
      ? "Set (32+ chars)"
      : "AUTH_SECRET is missing — users cannot sign in.",
    remediation: env.AUTH_SECRET
      ? undefined
      : "openssl rand -base64 32, then set as Vercel AUTH_SECRET env var.",
  });

  // Email (Resend)
  checks.push({
    name: "Email (Resend)",
    status: env.RESEND_API_KEY && env.RESEND_FROM_EMAIL ? "ok" : "missing",
    detail:
      env.RESEND_API_KEY && env.RESEND_FROM_EMAIL
        ? `From: ${env.RESEND_FROM_EMAIL}`
        : "Magic-link login + transactional emails disabled.",
    remediation:
      env.RESEND_API_KEY && env.RESEND_FROM_EMAIL
        ? undefined
        : "Set RESEND_API_KEY + RESEND_FROM_EMAIL in Vercel.",
  });

  // Storage (R2)
  checks.push({
    name: "File storage (R2)",
    status: r2IsConfigured() ? "ok" : "missing",
    detail: r2IsConfigured()
      ? `Bucket: ${env.R2_BUCKET}`
      : "Chef-document uploads disabled.",
    remediation: r2IsConfigured()
      ? undefined
      : "Run scripts/setup-r2.sh with bucket-scoped Cloudflare token.",
  });

  // Seed users present
  try {
    const result = await db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE status = 'active'`,
    );
    const n = Number(
      (result as unknown as { rows?: Array<{ n: number }> }).rows?.[0]?.n ??
        (Array.isArray(result) ? (result as Array<{ n: number }>)[0]?.n : 0),
    );
    checks.push({
      name: "Seed users",
      status: n >= 3 ? "ok" : "missing",
      detail: `${n} active users in DB`,
      remediation:
        n >= 3 ? undefined : "Run `npm run db:seed` to seed Jezza/Maarten/Gina.",
    });
  } catch {
    checks.push({
      name: "Seed users",
      status: "error",
      detail: "Could not query users table",
    });
  }

  const allOk = checks.every((c) => c.status === "ok");
  const anyError = checks.some((c) => c.status === "error");

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System health
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        {allOk ? "Alles werkt." : anyError ? "Er is iets stuk." : "Niet alles is ingesteld."}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
        Omgeving: <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">{env.VERCEL_ENV}</code>
        {isProduction && (
          <span className="ml-2 rounded-full bg-burgundy/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-burgundy">
            Production
          </span>
        )}
      </p>

      <ul className="mt-10 space-y-3">
        {checks.map((c) => (
          <li
            key={c.name}
            className="flex items-start gap-4 rounded-lg border border-ink-200 bg-white p-5"
          >
            <StatusDot status={c.status} />
            <div className="flex-1">
              <p className="font-ui text-sm font-medium text-ink-900">{c.name}</p>
              <p className="mt-0.5 text-xs text-ink-700">{c.detail}</p>
              {c.remediation && c.status !== "ok" && (
                <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Fix: </strong>
                  {c.remediation}
                </p>
              )}
            </div>
            <StatusBadge status={c.status} />
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs text-ink-500">
        Machine-readable: <code className="rounded bg-bg-gray px-1.5 py-0.5">GET /api/health</code>{" "}
        — 200 als de DB werkt, 503 als die down is.
      </p>
    </div>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  const color: Record<CheckStatus, string> = {
    ok: "bg-emerald-500",
    missing: "bg-amber-400",
    error: "bg-red-500",
  };
  return (
    <span
      className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${color[status]}`}
      aria-hidden
    />
  );
}

function StatusBadge({ status }: { status: CheckStatus }) {
  const labels: Record<CheckStatus, string> = {
    ok: "✓ OK",
    missing: "Niet ingesteld",
    error: "FOUT",
  };
  const tone: Record<CheckStatus, string> = {
    ok: "bg-emerald-100 text-emerald-700",
    missing: "bg-amber-100 text-amber-800",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone[status]}`}
    >
      {labels[status]}
    </span>
  );
}
