import { asc, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { auditLog, roles, userRoles, users } from "@/lib/db/schema";
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
      passwordHash: users.passwordHash,
      totpEnabled: users.totpEnabled,
      totpEnrolledAt: users.totpEnrolledAt,
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

  // Last successful sign-in per user — single query, GROUP BY user_id over
  // auth.signin rows. Cheap on small audit_log tables; if this gets slow
  // we'll add a denormalized lastSignInAt column on users.
  const lastSignins = await db
    .select({
      userId: auditLog.userId,
      lastAt: sql<string>`max(${auditLog.createdAt})`.as("last_at"),
    })
    .from(auditLog)
    .where(eq(auditLog.action, "auth.signin"))
    .groupBy(auditLog.userId);

  const lastSigninByUser = new Map<string, Date>();
  for (const row of lastSignins) {
    if (row.userId && row.lastAt) {
      lastSigninByUser.set(row.userId, new Date(row.lastAt));
    }
  }

  function relativeTime(d: Date | undefined | null): string {
    if (!d) return "—";
    const diffMs = Date.now() - d.getTime();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return "zojuist";
    if (minutes < 60) return `${minutes} min geleden`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} u geleden`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} d geleden`;
    return d.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            System
          </p>
          <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
            Users
          </h1>
        </div>
        <Link
          href="/admin/system/users/new"
          className="shrink-0 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          + Nieuwe medewerker
        </Link>
      </div>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Alle accounts in het systeem. Klik op &ldquo;Nieuwe medewerker&rdquo; om
        een interne collega uit te nodigen — ze krijgen een mail en lopen bij
        hun eerste login door de setup-wizard.
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[860px]">
          <thead className="bg-bg-gray text-left">
            <tr>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                E-mail
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Naam
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Type
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Status
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Setup
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                2FA
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Rollen
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Laatste login
              </th>
              <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                Bekijk als
              </th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((u, i) => {
              const setupDone = u.kind !== "internal"
                ? null
                : Boolean(u.passwordHash) && Boolean(u.totpEnabled);
              return (
                <tr
                  key={u.id}
                  className={
                    i < userRows.length - 1 ? "border-b border-ink-200" : ""
                  }
                >
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/admin/system/users/${u.id}`}
                      className="text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {u.email}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-700">
                    {u.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{u.kind}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {u.kind !== "internal" ? (
                      <span className="text-ink-500">n.v.t.</span>
                    ) : setupDone ? (
                      <span className="text-emerald-700">✓ klaar</span>
                    ) : (
                      <span className="text-amber-700">⚠ wacht</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {u.kind !== "internal" ? (
                      <span className="text-ink-500">n.v.t.</span>
                    ) : u.totpEnabled ? (
                      <span
                        className="text-emerald-700"
                        title={
                          u.totpEnrolledAt
                            ? `sinds ${new Date(u.totpEnrolledAt).toLocaleDateString("nl-NL")}`
                            : undefined
                        }
                      >
                        ✓ aan
                      </span>
                    ) : (
                      <span className="text-ink-500">uit</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {(rolesByUser.get(u.id) ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {relativeTime(lastSigninByUser.get(u.id))}
                  </td>
                  <td className="px-4 py-3">
                    {u.status === "active" &&
                    !(rolesByUser.get(u.id) ?? []).includes("super_admin") ? (
                      <form method="POST" action={`/api/impersonate/${u.id}`}>
                        <button
                          type="submit"
                          className="rounded-full border border-burgundy/40 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy hover:bg-burgundy/5"
                        >
                          Bekijk als
                        </button>
                      </form>
                    ) : (
                      <span
                        className="font-ui text-[10px] uppercase tracking-wider text-ink-400"
                        title={
                          (rolesByUser.get(u.id) ?? []).includes("super_admin")
                            ? "Kan geen super-admin impersoneren"
                            : "Account niet actief"
                        }
                      >
                        {(rolesByUser.get(u.id) ?? []).includes("super_admin") ? "—" : "geen toegang"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
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
