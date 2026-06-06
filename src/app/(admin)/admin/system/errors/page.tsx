import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { errorLog, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Errors" };

/**
 * Paginated error log viewer. super_admin only.
 *
 * Phase 0: read-only list (last 100). Pagination + resolution UI in a later phase.
 */
export default async function ErrorsPage() {
  await requirePermission("errors", "read");

  const rows = await db
    .select({
      id: errorLog.id,
      message: errorLog.message,
      stack: errorLog.stack,
      severity: errorLog.severity,
      url: errorLog.url,
      createdAt: errorLog.createdAt,
      resolvedAt: errorLog.resolvedAt,
      userId: errorLog.userId,
      userEmail: users.email,
    })
    .from(errorLog)
    .leftJoin(users, eq(users.id, errorLog.userId))
    .orderBy(desc(errorLog.createdAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Errors
      </h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Application errors logged to the <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">error_log</code> table.
        Sentry-replacement built-in. Latest 100 entries.
      </p>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">Geen errors gelogd</p>
          <p className="mt-2 text-sm text-ink-500">
            ✓ Alle systemen draaien normaal.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {rows.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-ink-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-ui text-sm text-ink-900">{e.message}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {new Date(e.createdAt).toLocaleString("nl-NL")}
                    {e.url && ` · ${e.url}`}
                    {e.userEmail && ` · ${e.userEmail}`}
                    {e.resolvedAt && ` · ✓ resolved`}
                  </p>
                  {e.stack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-burgundy hover:underline">
                        Stack trace
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-bg-gray p-3 text-[11px] leading-relaxed text-ink-700">
                        {e.stack}
                      </pre>
                    </details>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
                    e.severity === "critical"
                      ? "bg-red-100 text-red-700"
                      : e.severity === "error"
                        ? "bg-burgundy/10 text-burgundy"
                        : e.severity === "warning"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-bg-gray text-ink-700"
                  }`}
                >
                  {e.severity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
