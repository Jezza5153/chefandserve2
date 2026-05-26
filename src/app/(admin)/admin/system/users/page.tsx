import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { roles, userRoles, users } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Users" };

/**
 * User listing. super_admin only.
 * Read-only in Phase 0. Edit + role assignment in a later phase.
 */
export default async function UsersPage() {
  await requireRole("super_admin");

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      kind: users.kind,
      status: users.status,
      seedKey: users.seedKey,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  // Roles per user (one query, join in JS for tidiness)
  const allUserRoles = await db
    .select({
      userId: userRoles.userId,
      roleKey: roles.key,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));

  const rolesByUser = new Map<string, string[]>();
  for (const r of allUserRoles) {
    const existing = rolesByUser.get(r.userId) ?? [];
    rolesByUser.set(r.userId, [...existing, r.roleKey]);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Users
      </h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Alle accounts in het systeem. Phase 0 = read-only — edits via SQL of
        admin scripts.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full">
          <thead className="bg-bg-gray text-left">
            <tr>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Email
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Name
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Kind
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Status
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Roles
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Seed key
              </th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((u, i) => (
              <tr
                key={u.id}
                className={
                  i < userRows.length - 1 ? "border-b border-ink-200" : ""
                }
              >
                <td className="px-4 py-3 text-sm text-ink-900">{u.email}</td>
                <td className="px-4 py-3 text-sm text-ink-700">
                  {u.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs text-ink-500">{u.kind}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-4 py-3 text-xs text-ink-700">
                  {(rolesByUser.get(u.id) ?? []).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-500">
                  {u.seedKey ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "invited"
        ? "bg-amber-100 text-amber-700"
        : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}
