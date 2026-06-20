import { and, desc, eq, gte, ilike } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Audit log" };

/**
 * Audit log viewer. super_admin only. E2: searchable/filterable by resource · action ·
 * user · time window (reuses the audit_log_resource_idx for the resource filter).
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string; action?: string; user?: string; days?: string }>;
}) {
  await requirePermission("audit", "read");
  const sp = await searchParams;
  const fResource = sp.resource?.trim() ?? "";
  const fAction = sp.action?.trim() ?? "";
  const fUser = sp.user?.trim() ?? "";
  const fDays = sp.days ?? "";

  const conds = [];
  if (fResource) conds.push(eq(auditLog.resource, fResource));
  if (fAction) conds.push(ilike(auditLog.action, `%${fAction}%`));
  if (fUser) conds.push(ilike(users.email, `%${fUser}%`));
  const daysN = Number(fDays);
  if (Number.isFinite(daysN) && daysN > 0) conds.push(gte(auditLog.createdAt, new Date(Date.now() - daysN * 86_400_000)));

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
    .where(conds.length ? and(...conds) : undefined)
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
        Wie deed wat, wanneer. Filter op resource, actie, gebruiker of periode (max 200).
      </p>

      {/* E2: filters */}
      <form className="mt-6 flex flex-wrap items-end gap-2" action="/admin/system/audit">
        <label className="flex flex-col gap-1 text-[11px] text-ink-500">
          Resource
          <input name="resource" defaultValue={fResource} placeholder="chefs / shifts / ratings…" className="rounded border border-ink-200 bg-white px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-500">
          Actie bevat
          <input name="action" defaultValue={fAction} placeholder="updated / created…" className="rounded border border-ink-200 bg-white px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-500">
          Gebruiker (e-mail)
          <input name="user" defaultValue={fUser} placeholder="naam@…" className="rounded border border-ink-200 bg-white px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-500">
          Periode
          <select name="days" defaultValue={fDays} className="rounded border border-ink-200 bg-white px-2.5 py-1.5 text-sm">
            <option value="">Alles</option>
            <option value="1">24 uur</option>
            <option value="7">7 dagen</option>
            <option value="30">30 dagen</option>
            <option value="90">90 dagen</option>
          </select>
        </label>
        <button type="submit" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900">
          Filter
        </button>
        {(fResource || fAction || fUser || fDays) && (
          <a href="/admin/system/audit" className="rounded-full border border-ink-200 px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-600 hover:bg-bg-gray">
            Wis
          </a>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center text-sm text-ink-500">
          Geen audit-events geregistreerd.
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-ink-200 bg-white">
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
