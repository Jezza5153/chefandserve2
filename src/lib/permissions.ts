/**
 * Server-side permission helpers.
 *
 * Usage in a server component / server action:
 *   import { requireRole, hasPermission, requireAuth } from "@/lib/permissions";
 *   const session = await requireRole("super_admin");      // throws/redirects if not
 *   if (await hasPermission(session, "chefs", "write")) { ... }
 *
 * Permissions are loaded once per request from DB. We don't put individual
 * permissions in the JWT — only role keys. This keeps the JWT small and lets
 * permission changes take effect immediately (paired with permissionsVersion).
 */

import { redirect } from "next/navigation";
import { cache } from "react";
import { eq, inArray } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { permissions, rolePermissions, roles, userPermissions } from "@/lib/db/schema";
import { applyImpersonation } from "@/lib/domain/impersonation";

import type { Session } from "next-auth";

/* ------------------------------------------------------------------------- */

export type RoleKey = "super_admin" | "owner" | "planner" | (string & {}); // open for future roles

/** Default landing path per role. Used after login. */
export function defaultLandingFor(roleKeys: string[]): string {
  if (roleKeys.includes("super_admin")) return "/admin/system";
  if (roleKeys.includes("owner")) return "/admin/business";
  if (roleKeys.includes("planner")) return "/admin/planning";
  if (roleKeys.includes("chef")) return "/chef";
  if (roleKeys.includes("client")) return "/client";
  return "/admin";
}

/** Default landing path per user kind — used when a session has no roles yet. */
export function defaultLandingForKind(
  kind: "internal" | "chef" | "client",
): string {
  if (kind === "chef") return "/chef";
  if (kind === "client") return "/client";
  return "/admin";
}

/** True if the session has ANY of the listed roles. */
export function hasRole(
  session: Session | null,
  ...required: RoleKey[]
): boolean {
  if (!session?.user?.roles) return false;
  return required.some((r) => session.user.roles.includes(r));
}

/**
 * Server helper — get the current session or redirect to /login.
 * Use in any server component that requires auth.
 */
export async function requireAuth(nextPath = "/admin"): Promise<Session> {
  const real = await auth();
  if (!real?.user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  // Phase B: overlay impersonation (no-op unless a super_admin is actively
  // impersonating). Safe fallback to `real` on any failure.
  const session = await applyImpersonation(real);
  return session ?? real;
}

/**
 * Server helper — verify the session has the required role. super_admin
 * bypasses all role checks (founder rule: super_admin sees everything).
 * Otherwise redirect to the user's default landing (no blank pages).
 *
 * Pass `{ strict: true }` to disable the super_admin bypass — useful when
 * a route should be visible to a SPECIFIC role only (e.g. an
 * impersonation-warning banner shown only to owners).
 */
export async function requireRole(
  required: RoleKey,
  nextPath = "/admin",
  options: { strict?: boolean } = {},
): Promise<Session> {
  const session = await requireAuth(nextPath);
  const allowed =
    hasRole(session, required) ||
    (!options.strict && hasRole(session, "super_admin"));
  if (!allowed) {
    redirect(defaultLandingFor(session.user.roles));
  }
  return session;
}

/**
 * Like requireRole, but allows ANY of several roles. super_admin still bypasses
 * unless { strict: true }. Used where multiple roles share a surface — e.g. chef
 * editing, the form-builder, and reminders are open to owner AND planner.
 */
export async function requireAnyRole(
  required: RoleKey[],
  nextPath = "/admin",
  options: { strict?: boolean } = {},
): Promise<Session> {
  const session = await requireAuth(nextPath);
  const allowed =
    hasRole(session, ...required) ||
    (!options.strict && hasRole(session, "super_admin"));
  if (!allowed) {
    redirect(defaultLandingFor(session.user.roles));
  }
  return session;
}

/**
 * Permission-gated guard (PR-RBAC C2) — the permission-based successor to
 * requireRole/requireAnyRole. Redirects to the user's landing on deny (no blank
 * pages); super_admin always passes (holds all). Dormant until the gate-flip
 * (C3) swaps the role-name gates to call this.
 *
 * No `strict` option by design: today's `{ strict: true }` system pages map to
 * system permissions that only super_admin holds, so the bypass is correct.
 */
export async function requirePermission(
  resource: string,
  action: string,
  nextPath = "/admin",
): Promise<Session> {
  const session = await requireAuth(nextPath);
  if (hasRole(session, "super_admin")) return session; // bypass — holds all
  if (await hasPermission(session, resource, action)) return session;
  redirect(defaultLandingFor(session.user.roles));
}

/**
 * Fence 4 — assert that an internal user has completed the setup wizard
 * before allowing a server action / API route to proceed.
 *
 * Middleware already redirects pages, but server actions and API routes
 * bypass page render entirely. Call this at the top of any admin-only
 * server action that mutates state.
 *
 * Behavior:
 *   - Non-internal users → pass-through (chefs/clients have no wizard).
 *   - Internal user with hasPassword + totpEnabled → pass-through.
 *   - Internal user missing either → throws an Error that the caller
 *     should redirect on, AND writes auth.setup_incomplete_blocked audit.
 *
 * Throws so callers can use it as a guard at the top of an action.
 */
export async function assertSetupComplete(session: Session): Promise<void> {
  if (session.user.kind !== "internal") return;
  if (session.user.hasPassword && session.user.totpEnabled) return;

  // Block + audit. Importing db here would create a circular dep, so we
  // use a lazy import.
  const { db } = await import("@/lib/db/client");
  const { auditLog } = await import("@/lib/db/schema");
  await db
    .insert(auditLog)
    .values({
      userId: session.user.id,
      action: "auth.setup_incomplete_blocked",
      resource: "users",
      resourceId: session.user.id,
      after: {
        hasPassword: session.user.hasPassword,
        totpEnabled: session.user.totpEnabled,
      },
    })
    .catch(() => {});

  throw new Error("SETUP_INCOMPLETE");
}

/**
 * Per-request memoized loader of a user's EFFECTIVE permission set (PR-RBAC-1):
 *   effective = (role grants ∪ user grants) − user revokes
 *
 * Revoke is final/subtractive (an explicit deny always wins). super_admin is
 * handled by the caller (returns true before this runs), so this only loads for
 * non-super_admin users. React cache() memoizes per request lifecycle, so N gate
 * checks in one render do ONE pair of indexed queries (not N). Keyed on userId +
 * the sorted role-key CSV so an impersonated effective user doesn't collide.
 */
const loadEffectivePermissionSet = cache(
  async (userId: string, roleKeysCsv: string): Promise<Set<string>> => {
    const roleKeys = roleKeysCsv.split(",").filter(Boolean);
    const set = new Set<string>();
    if (roleKeys.length > 0) {
      const rolePerms = await db
        .select({ resource: permissions.resource, action: permissions.action })
        .from(permissions)
        .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .where(inArray(roles.key, roleKeys));
      for (const p of rolePerms) set.add(`${p.resource}.${p.action}`);
    }
    const overrides = await db
      .select({
        resource: userPermissions.resource,
        action: userPermissions.action,
        effect: userPermissions.effect,
      })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));
    for (const o of overrides) {
      const key = `${o.resource}.${o.action}`;
      if (o.effect === "grant") set.add(key);
      else set.delete(key); // revoke wins, even over a role grant
    }
    return set;
  },
);

/**
 * True if the session's roles + per-user overrides grant the permission.
 * super_admin holds everything (bypass — never revoke-locked out). Permissions
 * are loaded once per request (memoized), NOT stored in the JWT, so role/override
 * edits take effect immediately (paired with permissionsVersion invalidation).
 *
 * Dormant until the gate-flip (PR-RBAC C3) wires requirePermission to call this.
 */
export async function hasPermission(
  session: Session | null,
  resource: string,
  action: string,
): Promise<boolean> {
  if (!session?.user?.roles?.length) return false;
  if (session.user.roles.includes("super_admin")) return true; // bypass — holds all
  const roleKeysCsv = [...session.user.roles].sort().join(",");
  const set = await loadEffectivePermissionSet(session.user.id, roleKeysCsv);
  return set.has(`${resource}.${action}`);
}
