import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { permissions, rolePermissions, roles } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Roles" };

/**
 * Roles + their permissions. super_admin only.
 * Read-only in Phase 0.
 */
export default async function RolesPage() {
  await requireRole("super_admin");

  const allRoles = await db.select().from(roles).orderBy(asc(roles.key));

  const allRolePerms = await db
    .select({
      roleId: rolePermissions.roleId,
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));

  const permsByRole = new Map<string, string[]>();
  for (const rp of allRolePerms) {
    const key = `${rp.resource}.${rp.action}`;
    const existing = permsByRole.get(rp.roleId) ?? [];
    permsByRole.set(rp.roleId, [...existing, key]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Roles &amp; permissions
      </h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Bundles of <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">(resource, action)</code> permissions
        assigned to users via <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">user_roles</code>.
        Read-only in Phase 0.
      </p>

      <div className="mt-8 space-y-4">
        {allRoles.map((role) => {
          const perms = (permsByRole.get(role.id) ?? []).sort();
          return (
            <div
              key={role.id}
              className="rounded-lg border border-ink-200 bg-white p-6"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="font-serif text-xl text-ink-900">
                    {role.label}
                  </h2>
                  <p className="mt-1 font-mono text-xs text-ink-500">
                    {role.key}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-burgundy/10 px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-burgundy">
                  {perms.length} perms
                </span>
              </div>
              {role.description && (
                <p className="mt-3 text-sm text-ink-700">{role.description}</p>
              )}
              {perms.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {perms.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-bg-gray px-2 py-1 font-mono text-[11px] text-ink-700"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
