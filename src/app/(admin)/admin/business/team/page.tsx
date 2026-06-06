/**
 * /admin/business/team — owner-facing employee management (PR-RBAC C6).
 *
 * Owners (+ super_admin) create staff and set what they can do. Distinct from
 * the super_admin /admin/system/users (which is system user administration).
 * The escalation guards in manage.ts confine owners to business perms.
 */

import { asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { roles, userRoles, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";
import { createEmployee } from "@/lib/rbac/manage";

export const metadata = { title: "Team", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requirePermission("team", "read");
  const sp = await searchParams;

  const internal = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.kind, "internal"))
    .orderBy(asc(users.name));

  const roleRows = await db
    .select({ userId: userRoles.userId, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    if (!rolesByUser.has(r.userId)) rolesByUser.set(r.userId, []);
    rolesByUser.get(r.userId)!.push(r.key);
  }

  // assignable roles for the create form — exclude super_admin (system).
  const assignable = await db
    .select({ key: roles.key, label: roles.label })
    .from(roles)
    .where(ne(roles.key, "super_admin"))
    .orderBy(asc(roles.key));

  async function addEmployee(formData: FormData) {
    "use server";
    const session = await requirePermission("team", "manage", "/admin/business/team");
    const res = await createEmployee({
      session,
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      roleKey: String(formData.get("roleKey") ?? ""),
    });
    redirect(res.ok ? "/admin/business/team?ok=created" : `/admin/business/team?err=${encodeURIComponent(res.error)}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Bedrijf</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Team</h1>
      <p className="mt-2 text-sm text-ink-500">
        Beheer je medewerkers en wat ze mogen. Nieuwe medewerkers krijgen een uitnodiging per e-mail.
      </p>

      {sp.ok && (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Medewerker uitgenodigd.
        </p>
      )}
      {sp.err && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Niet gelukt: {sp.err}
        </p>
      )}

      {/* create employee — role is asked each time (no default) */}
      <details className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <summary className="cursor-pointer font-ui text-[12px] font-medium text-burgundy">+ Nieuwe medewerker</summary>
        <form action={addEmployee} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input name="name" placeholder="Volledige naam" required className="rounded border border-ink-200 px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="E-mailadres" required className="rounded border border-ink-200 px-3 py-2 text-sm" />
          <select name="roleKey" required defaultValue="" className="rounded border border-ink-200 px-3 py-2 text-sm">
            <option value="" disabled>
              Kies een rol…
            </option>
            {assignable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label} ({r.key})
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">
            Uitnodigen
          </button>
        </form>
      </details>

      {/* employee list */}
      <div className="mt-6 overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-bg-gray text-left font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">
            <tr>
              <th className="px-4 py-2.5">Naam</th>
              <th className="px-4 py-2.5">Rollen</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {internal.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-900">{u.name}</p>
                  <p className="text-xs text-ink-500">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-ink-700">
                  {(rolesByUser.get(u.id) ?? []).join(", ") || <span className="text-ink-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${u.status === "active" ? "bg-emerald-100 text-emerald-700" : u.status === "invited" ? "bg-amber-100 text-amber-800" : "bg-ink-100 text-ink-600"}`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/business/team/${u.id}`} className="font-ui text-[12px] font-medium text-burgundy hover:underline">
                    Beheren →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
