/**
 * /admin/system/users/[id] — user detail + admin actions.
 *
 * PR-C0. Super_admin only (matches the /admin/system/* role gate).
 *
 * Actions:
 *   - Reset 2FA (Fence 1: cookie revocation via permissionsVersion + cookie
 *     enrolledAtMs check)
 *
 * Future:
 *   - Disable / re-enable user
 *   - Change role
 *   - Force password reset
 */

import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { roles, userRoles, users } from "@/lib/db/schema";
import { resetInternalUser2FA } from "@/lib/domain/auth-admin";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Gebruiker", robots: { index: false } };
export const dynamic = "force-dynamic";

async function reset2FA(formData: FormData) {
  "use server";
  const session = await requireRole("super_admin", "/admin/system/users", {
    strict: true,
  });

  const targetUserId = String(formData.get("targetUserId") ?? "");
  const confirmationEmail = String(formData.get("confirmationEmail") ?? "")
    .trim()
    .toLowerCase();

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });
  if (!target) redirect(`/admin/system/users/${targetUserId}?error=not-found`);
  if (target.email.toLowerCase() !== confirmationEmail) {
    redirect(`/admin/system/users/${targetUserId}?error=confirmation-mismatch`);
  }

  const result = await resetInternalUser2FA({
    targetUserId,
    actingUserId: session.user.id,
  });

  if (!result.ok) {
    redirect(
      `/admin/system/users/${targetUserId}?error=${encodeURIComponent(result.error)}`,
    );
  }

  redirect(`/admin/system/users/${targetUserId}?reset=1`);
}

async function manageRoles(formData: FormData) {
  "use server";
  const session = await requireRole("super_admin", "/admin/system/users", {
    strict: true,
  });

  const targetUserId = String(formData.get("targetUserId") ?? "");
  const selected = formData.getAll("roleKey").map(String);

  const target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
  if (!target) redirect(`/admin/system/users/${targetUserId}?error=not-found`);

  const allRoles = await db.select().from(roles);
  const allowed = new Set(allRoles.map((r) => r.key));
  const selectedSet = new Set(selected.filter((k) => allowed.has(k)));

  const currentRows = await db
    .select({ key: roles.key, roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, targetUserId));
  const currentKeys = new Set(currentRows.map((r) => r.key));

  // Guard: never remove the last super_admin.
  if (currentKeys.has("super_admin") && !selectedSet.has("super_admin")) {
    const supers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.key, "super_admin"));
    if (supers.length <= 1) {
      redirect(
        `/admin/system/users/${targetUserId}?error=${encodeURIComponent("Kan de laatste super_admin niet verwijderen.")}`,
      );
    }
  }

  const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id] as const));
  for (const key of selectedSet) {
    if (!currentKeys.has(key)) {
      const rid = roleIdByKey.get(key);
      if (rid) {
        await db.insert(userRoles).values({ userId: targetUserId, roleId: rid }).onConflictDoNothing();
      }
    }
  }
  for (const row of currentRows) {
    if (!selectedSet.has(row.key)) {
      await db
        .delete(userRoles)
        .where(and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, row.roleId)));
    }
  }

  // Bump permissionsVersion so the target's JWT invalidates on their next request.
  await db
    .update(users)
    .set({ permissionsVersion: target.permissionsVersion + 1, updatedAt: new Date() })
    .where(eq(users.id, targetUserId));

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "user.roles_updated",
    resource: "users",
    resourceId: targetUserId,
    after: { roles: [...selectedSet] },
  });
  redirect(`/admin/system/users/${targetUserId}?roles=1`);
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reset?: string; error?: string; roles?: string }>;
}) {
  const session = await requireRole("super_admin", undefined, { strict: true });
  const { id } = await params;
  const sp = await searchParams;

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  if (!user) notFound();

  const userRoleRows = await db
    .select({ key: roles.key, label: roles.label })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));

  const allRoles = await db.select({ key: roles.key, label: roles.label }).from(roles);
  const currentRoleKeys = new Set(userRoleRows.map((r) => r.key));

  // Count active super_admins so we can warn if the target is the only one
  const allSuperAdmins = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.key, "super_admin"));
  const superAdminCount = allSuperAdmins.length;
  const targetIsOnlySuperAdmin =
    userRoleRows.some((r) => r.key === "super_admin") && superAdminCount <= 1;

  const isSelfReset = session.user.id === user.id;

  const flashMsg = sp.reset === "1"
    ? `✓ 2FA gereset voor ${user.email}. Bij hun volgende request worden ze uitgelogd en moeten ze opnieuw een wachtwoord + 2FA instellen.`
    : sp.roles === "1"
      ? `✓ Rollen bijgewerkt voor ${user.email}. De sessie wordt bij hun volgende request vernieuwd.`
      : null;

  const errorMsg =
    sp.error === "confirmation-mismatch"
      ? "E-mailbevestiging klopt niet — typfout?"
      : sp.error === "not-found"
        ? "Gebruiker niet meer gevonden."
        : sp.error
          ? decodeURIComponent(sp.error)
          : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/system/users"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Terug naar gebruikers
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System · user
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        {user.name ?? user.email}
      </h1>
      <p className="mt-2 text-sm text-ink-500">{user.email}</p>

      {flashMsg ? (
        <p className="mt-6 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashMsg}
        </p>
      ) : null}
      {errorMsg ? (
        <p className="mt-6 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          ⚠ {errorMsg}
        </p>
      ) : null}

      {/* Identity */}
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <DetailCard label="Type">{user.kind}</DetailCard>
        <DetailCard label="Status">{user.status}</DetailCard>
        <DetailCard label="Rollen">
          {userRoleRows.length > 0
            ? userRoleRows.map((r) => r.label).join(", ")
            : "geen"}
        </DetailCard>
        <DetailCard label="Aangemaakt op">
          {new Date(user.createdAt).toLocaleString("nl-NL")}
        </DetailCard>
        <DetailCard label="2FA">
          {user.totpEnabled
            ? `Actief sinds ${user.totpEnrolledAt ? new Date(user.totpEnrolledAt).toLocaleString("nl-NL") : "—"}`
            : "Uit"}
        </DetailCard>
        <DetailCard label="Wachtwoord">
          {user.passwordHash
            ? `Ingesteld op ${user.passwordSetAt ? new Date(user.passwordSetAt).toLocaleString("nl-NL") : "—"}`
            : "Nog niet ingesteld"}
        </DetailCard>
      </div>

      {/* Reset 2FA — only for internal users who have 2FA enabled */}
      {user.kind === "internal" && user.totpEnabled ? (
        <section className="mt-12 rounded-lg border border-burgundy/30 bg-burgundy/5 p-6">
          <h2 className="font-serif text-xl text-ink-900">
            2FA resetten
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            Wist alle 2FA-gegevens voor deze gebruiker. Ze worden direct
            uitgelogd op alle apparaten en moeten bij hun volgende login
            opnieuw door de setup-wizard (wachtwoord blijft, alleen 2FA wordt
            opnieuw ingesteld). Audit-trail bewaard.
          </p>
          {isSelfReset ? (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Je reset je EIGEN 2FA.</strong> Je wordt direct uitgelogd
              en hebt een magic-link nodig om weer in te komen. Zorg dat je
              toegang hebt tot je e-mail.
            </p>
          ) : null}
          {targetIsOnlySuperAdmin ? (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Let op:</strong> dit is de enige super_admin met 2FA aan.
              Als de re-enrollment mislukt, kun je het systeem niet meer in
              behalve via SQL.
            </p>
          ) : null}

          <form action={reset2FA} className="mt-5 space-y-3">
            <input type="hidden" name="targetUserId" value={user.id} />
            <label className="block">
              <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                Type ter bevestiging het e-mailadres in
              </span>
              <input
                type="email"
                name="confirmationEmail"
                required
                placeholder={user.email}
                autoComplete="off"
                className="w-full max-w-md rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
            >
              Reset 2FA
            </button>
          </form>
        </section>
      ) : null}

      {/* Rollen beheren — PR-PLAN. super_admin only (page is super_admin-gated). */}
      {user.kind === "internal" ? (
        <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
          <h2 className="font-serif text-xl text-ink-900">Rollen beheren</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            Bepaal wat deze medewerker mag. <strong>Planner</strong> = chefs, rooster/shifts, formulieren
            &amp; herinneringen. <strong>Owner</strong> = volledige business. <strong>Super admin</strong> =
            alles incl. systeembeheer.
          </p>
          <form action={manageRoles} className="mt-4 space-y-2">
            <input type="hidden" name="targetUserId" value={user.id} />
            {allRoles.map((r) => (
              <label key={r.key} className="flex items-center gap-2 text-sm text-ink-800">
                <input
                  type="checkbox"
                  name="roleKey"
                  value={r.key}
                  defaultChecked={currentRoleKeys.has(r.key)}
                  className="h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy"
                />
                {r.label} <span className="text-ink-400">({r.key})</span>
              </label>
            ))}
            <button
              type="submit"
              className="mt-2 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Rollen opslaan
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-ink-200 bg-white p-4">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink-900">{children}</p>
    </div>
  );
}
