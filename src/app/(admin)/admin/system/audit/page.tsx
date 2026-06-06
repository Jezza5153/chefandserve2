import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Audit log" };

/**
 * Audit log viewer. super_admin only.
 * Phase 0: simple list (last 200 entries). Search + filtering later.
 */
export default async function AuditPage() {
  await requirePermission("audit", "read");

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resource: auditLog.resource,
      resourceId: auditLog.resourceId,
      createdAt: auditLog.createdAt,
      userEmail: users.email,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Audit log
      </h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Wie deed wat, wanneer. Latest 200 entries.
      </p>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center text-sm text-ink-500">
          Geen audit-events geregistreerd.
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-ink-200 bg-white">
          <table className="w-full">
            <thead className="bg-bg-gray text-left">
              <tr>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  When
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Who
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Action
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Resource
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {new Date(r.createdAt).toLocaleString("nl-NL")}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-900">
                    {r.userEmail ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-700">
                    {r.action}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-700">
                    {r.resource}
                    {r.resourceId && (
                      <span className="ml-1 text-xs text-ink-500">
                        ({r.resourceId.slice(0, 8)}…)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-500">
                    {r.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
