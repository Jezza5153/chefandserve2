import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { permissions, rolePermissions, roles } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";
import { CATALOG } from "@/lib/rbac/catalog";
import { createRole, saveRolePermissions } from "@/lib/rbac/manage";

export const metadata = { title: "Roles" };
export const dynamic = "force-dynamic";

const SYSTEM_PERMS = CATALOG.filter((p) => p.class === "system");
const BUSINESS_PERMS = CATALOG.filter((p) => p.class === "business");

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requirePermission("roles", "read");
  const sp = await searchParams;

  const allRoles = await db.select().from(roles).orderBy(asc(roles.key));
  const allRolePerms = await db
    .select({ roleKey: roles.key, resource: permissions.resource, action: permissions.action })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId));

  const permsByRole = new Map<string, Set<string>>();
  for (const rp of allRolePerms) {
    if (!permsByRole.has(rp.roleKey)) permsByRole.set(rp.roleKey, new Set());
    permsByRole.get(rp.roleKey)!.add(`${rp.resource}.${rp.action}`);
  }

  async function savePerms(formData: FormData) {
    "use server";
    const session = await requirePermission("roles", "write", "/admin/system/roles");
    const roleKey = String(formData.get("roleKey") ?? "");
    const permKeys = formData.getAll("perm").map(String);
    const res = await saveRolePermissions({ session, roleKey, permKeys });
    redirect(res.ok ? "/admin/system/roles?ok=perms" : `/admin/system/roles?err=${res.error}`);
  }

  async function addRole(formData: FormData) {
    "use server";
    const session = await requirePermission("roles", "write", "/admin/system/roles");
    const res = await createRole({
      session,
      key: String(formData.get("key") ?? ""),
      label: String(formData.get("label") ?? ""),
      description: String(formData.get("description") ?? ""),
    });
    redirect(res.ok ? "/admin/system/roles?ok=created" : `/admin/system/roles?err=${res.error}`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">System</p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">Roles &amp; permissions</h1>
      <p className="mt-4 text-sm text-ink-700">
        Bundles of permissions assigned to users via roles. Toggle a role&apos;s capabilities and save —
        every user holding that role re-reads on their next request.
      </p>

      {sp.ok && (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok === "created" ? "Rol aangemaakt." : "Rechten opgeslagen."}
        </p>
      )}
      {sp.err && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Niet opgeslagen: {sp.err}
        </p>
      )}

      {/* create role */}
      <details className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <summary className="cursor-pointer font-ui text-[12px] font-medium text-burgundy">+ Nieuwe rol</summary>
        <form action={addRole} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input name="key" placeholder="key (bv. senior_planner)" required className="rounded border border-ink-200 px-3 py-2 text-sm" />
          <input name="label" placeholder="Label" required className="rounded border border-ink-200 px-3 py-2 text-sm" />
          <input name="description" placeholder="Omschrijving" className="rounded border border-ink-200 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900 sm:col-span-1">
            Aanmaken
          </button>
        </form>
      </details>

      <div className="mt-6 space-y-5">
        {allRoles.map((role) => {
          const held = permsByRole.get(role.key) ?? new Set<string>();
          return (
            <form
              key={role.id}
              action={savePerms}
              className="rounded-lg border border-ink-200 bg-white p-6"
            >
              <input type="hidden" name="roleKey" value={role.key} />
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="font-serif text-xl text-ink-900">{role.label}</h2>
                  <p className="mt-1 font-mono text-xs text-ink-500">{role.key}</p>
                </div>
                <span className="shrink-0 rounded-full bg-burgundy/10 px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-burgundy">
                  {held.size} perms
                </span>
              </div>
              {role.description && <p className="mt-2 text-sm text-ink-700">{role.description}</p>}

              <PermGroup title="Business" perms={BUSINESS_PERMS} held={held} disabled={role.key === "super_admin"} />
              <PermGroup title="Systeem" perms={SYSTEM_PERMS} held={held} disabled={role.key === "super_admin"} />

              {role.key === "super_admin" ? (
                <p className="mt-4 text-xs text-ink-500">super_admin holds every permission — not editable.</p>
              ) : (
                <button type="submit" className="mt-4 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">
                  Opslaan
                </button>
              )}
            </form>
          );
        })}
      </div>
    </div>
  );
}

function PermGroup({
  title,
  perms,
  held,
  disabled,
}: {
  title: string;
  perms: typeof CATALOG;
  held: Set<string>;
  disabled: boolean;
}) {
  return (
    <fieldset className="mt-4" disabled={disabled}>
      <legend className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</legend>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {perms.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm text-ink-800">
            <input
              type="checkbox"
              name="perm"
              value={p.key}
              defaultChecked={disabled ? true : held.has(p.key)}
              className="h-3.5 w-3.5 rounded border-ink-300 text-burgundy focus:ring-burgundy"
            />
            <span>
              {p.label} <span className="font-mono text-[10px] text-ink-400">{p.key}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
