import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, errorLog, users } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

/**
 * Super_admin / IT dashboard.
 *
 * Phase 0: counts of users, recent errors, recent audit events.
 */
export const metadata = { title: "System" };

export default async function SystemDashboardPage() {
  await requireRole("super_admin");

  const [{ userCount }] = await db
    .select({ userCount: sql<number>`count(*)::int` })
    .from(users);

  const [{ errorCount }] = await db
    .select({ errorCount: sql<number>`count(*)::int` })
    .from(errorLog);

  const [{ unresolvedErrors }] = await db
    .select({ unresolvedErrors: sql<number>`count(*)::int` })
    .from(errorLog)
    .where(sql`${errorLog.resolvedAt} IS NULL`);

  const [{ auditCount }] = await db
    .select({ auditCount: sql<number>`count(*)::int` })
    .from(auditLog);

  const recentErrors = await db
    .select({
      id: errorLog.id,
      message: errorLog.message,
      severity: errorLog.severity,
      createdAt: errorLog.createdAt,
      resolvedAt: errorLog.resolvedAt,
    })
    .from(errorLog)
    .orderBy(desc(errorLog.createdAt))
    .limit(5);

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System overview
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        IT dashboard
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
        Errors, audit log, system health. Jezza-only. Sentry deferred —
        errors live in our own table at <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">error_log</code>.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-4">
        <StatCard label="Users" value={userCount} href="/admin/system/users" />
        <StatCard
          label="Errors"
          value={errorCount}
          sub={`${unresolvedErrors} open`}
          href="/admin/system/errors"
          highlight={unresolvedErrors > 0}
        />
        <StatCard label="Audit events" value={auditCount} href="/admin/system/audit" />
        <StatCard label="Health" value="—" sub="Binnenkort" />
      </div>

      <section className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900 md:text-2xl">
            Recente errors
          </h2>
          <Link
            href="/admin/system/errors"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Alle errors →
          </Link>
        </div>

        {recentErrors.length === 0 ? (
          <p className="rounded border border-ink-200 bg-white px-4 py-6 text-center text-sm text-ink-500">
            Geen errors gelogd. ✓
          </p>
        ) : (
          <ul className="space-y-2">
            {recentErrors.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-4 rounded border border-ink-200 bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-ui text-sm text-ink-900">
                    {e.message}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(e.createdAt).toLocaleString("nl-NL")}
                    {e.resolvedAt && " · ✓ resolved"}
                  </p>
                </div>
                <SeverityBadge severity={e.severity} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  highlight?: boolean;
}) {
  const inner = (
    <div
      className={`rounded-lg border bg-white p-5 transition-colors ${
        highlight ? "border-burgundy/40 bg-burgundy/5" : "border-ink-200"
      }`}
    >
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl text-ink-900">{value}</p>
      {sub && (
        <p
          className={`mt-1 text-xs ${
            highlight ? "text-burgundy" : "text-ink-500"
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === "critical"
      ? "bg-red-100 text-red-700"
      : severity === "error"
        ? "bg-burgundy/10 text-burgundy"
        : severity === "warning"
          ? "bg-amber-100 text-amber-700"
          : "bg-bg-gray text-ink-700";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {severity}
    </span>
  );
}
