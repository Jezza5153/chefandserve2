/**
 * /admin/business/team/[id] — owner-facing employee detail (PR-RBAC C6).
 * Assign roles + set per-person capability overrides. All writes go through the
 * guarded manage.ts (owners confined to business perms; never super_admin).
 */

import { asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { roles, userPermissions, userRoles, users } from "@/lib/db/schema";
import { effectivePermissionKeys, requirePermission } from "@/lib/permissions";
import { CATALOG } from "@/lib/rbac/catalog";
import { assignRoles, setUserPermission } from "@/lib/rbac/manage";

export const metadata = { title: "Medewerker", robots: { index: false } };
export const dynamic = "force-dynamic";

async function manageRoles(formData: FormData) {
  "use server";
  const session = await requirePermission("team", "manage", "/admin/business/team");
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const roleKeys = formData.getAll("roleKey").map(String);
  const res = await assignRoles({ session, targetUserId, roleKeys });
  redirect(
    res.ok
      ? `/admin/business/team/${targetUserId}?roles=1`
      : `/admin/business/team/${targetUserId}?err=${encodeURIComponent(res.error)}`,
  );
}

async function setOverride(formData: FormData) {
  "use server";
  const session = await requirePermission("team", "manage", "/admin/business/team");
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const current = await db
    .select({ resource: userPermissions.resource, action: userPermissions.action, effect: userPermissions.effect })
    .from(userPermissions)
    .where(eq(userPermissions.userId, targetUserId));
  const curMap = new Map(current.map((c) => [`${c.resource}.${c.action}`, c.effect as string]));
  for (const p of CATALOG) {
    const submitted = String(formData.get(`effect_${p.key}`) ?? "");
    if (!submitted) continue;
    if (submitted !== (curMap.get(p.key) ?? "inherit")) {
      await setUserPermission({
        session,
        targetUserId,
        resource: p.resource,
        action: p.action,
        effect: submitted as "grant" | "revoke" | "inherit",
      });
    }
  }
  redirect(`/admin/business/team/${targetUserId}?ovr=1`);
}

export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ roles?: string; ovr?: string; err?: string }>;
}) {
  await requirePermission("team", "manage");
  const { id } = await params;
  const sp = await searchParams;

  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user || user.kind !== "internal") notFound();

  const userRoleRows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));
  const currentRoleKeys = new Set(userRoleRows.map((r) => r.key));
  const isSuperAdminTarget = currentRoleKeys.has("super_admin");

  // assignable roles — super_admin is hidden (owners can't assign it; guarded).
  const assignable = await db
    .select({ key: roles.key, label: roles.label })
    .from(roles)
    .where(ne(roles.key, "super_admin"))
    .orderBy(asc(roles.key));

  const targetEffective = await effectivePermissionKeys({
    user: { id: user.id, roles: [...currentRoleKeys] },
  } as never);
  const overrideRows = await db
    .select({ resource: userPermissions.resource, action: userPermissions.action, effect: userPermissions.effect })
    .from(userPermissions)
    .where(eq(userPermissions.userId, user.id));
  const overrideMap = new Map(overrideRows.map((o) => [`${o.resource}.${o.action}`, o.effect as string]));
  const businessPerms = CATALOG.filter((p) => p.class === "business");

  const flash =
    sp.roles === "1" ? "Rollen bijgewerkt." : sp.ovr === "1" ? "Rechten bijgewerkt." : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin/business/team" className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
        ← Terug naar team
      </Link>
      <h1 className="mt-4 font-serif text-3xl text-ink-900">{user.name}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {user.email} · <span className="uppercase">{user.status}</span>
      </p>

      {flash && (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>
      )}
      {sp.err && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">Niet gelukt: {sp.err}</p>
      )}

      {isSuperAdminTarget ? (
        <p className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          Deze medewerker is een <strong>super_admin</strong>. Beheer systeemtoegang via Systeem → Users.
        </p>
      ) : (
        <>
          {/* roles */}
          <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
            <h2 className="font-serif text-xl text-ink-900">Rol</h2>
            <p className="mt-1 text-sm text-ink-700">Bepaalt de basistoegang. Verfijn hieronder per recht.</p>
            <form action={manageRoles} className="mt-4 space-y-2">
              <input type="hidden" name="targetUserId" value={user.id} />
              {assignable.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-sm text-ink-800">
                  <input type="checkbox" name="roleKey" value={r.key} defaultChecked={currentRoleKeys.has(r.key)} className="h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy" />
                  {r.label} <span className="text-ink-400">({r.key})</span>
                </label>
              ))}
              <button type="submit" className="mt-2 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">
                Rol opslaan
              </button>
            </form>
          </section>

          {/* overrides */}
          <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
            <h2 className="font-serif text-xl text-ink-900">Individuele rechten</h2>
            <p className="mt-1 text-sm text-ink-700">
              <strong>Toekennen</strong> = extra recht, <strong>intrekken</strong> = ontnemen (ook als de rol het geeft),
              standaard = volg de rol.
            </p>
            <form action={setOverride} className="mt-4">
              <input type="hidden" name="targetUserId" value={user.id} />
              <div className="divide-y divide-ink-100">
                {businessPerms.map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink-800">
                      {p.label} <span className="font-mono text-[10px] text-ink-400">{p.key}</span>
                      {targetEffective.has(p.key) && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700">
                          actief
                        </span>
                      )}
                    </span>
                    <select name={`effect_${p.key}`} defaultValue={overrideMap.get(p.key) ?? "inherit"} className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-800">
                      <option value="inherit">Standaard (rol)</option>
                      <option value="grant">Toekennen</option>
                      <option value="revoke">Intrekken</option>
                    </select>
                  </div>
                ))}
              </div>
              <button type="submit" className="mt-4 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">
                Rechten opslaan
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
