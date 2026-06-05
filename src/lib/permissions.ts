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
import { and, eq, inArray } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { permissions, rolePermissions, roles } from "@/lib/db/schema";
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
 * True if the session's roles collectively grant the given permission.
 * Looks up role_permissions live in DB (cached implicitly by Next.js fetch
 * cache + edge — Phase 0 doesn't add an explicit cache).
 */
export async function hasPermission(
  session: Session | null,
  resource: string,
  action: string,
): Promise<boolean> {
  if (!session?.user?.roles?.length) return false;

  // super_admin gets everything by convention (also covered by DB grants,
  // but checking here avoids a DB roundtrip).
  if (session.user.roles.includes("super_admin")) return true;

  const rows = await db
    .select({ id: permissions.id })
    .from(permissions)
    .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(
      and(
        eq(permissions.resource, resource),
        eq(permissions.action, action),
        inArray(roles.key, session.user.roles),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
