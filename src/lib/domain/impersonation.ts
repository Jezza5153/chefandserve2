/**
 * Impersonation — super_admin can act as any other user.
 *
 * STATUS: foundation only. The cookies + audit logging are wired, but the
 * Auth.js JWT callback needs an additional integration to actually swap
 * sessions mid-request. UI is deferred to a future session. Until then,
 * super_admin can still preview any portal because /chef and /client
 * routes allow super_admin role through middleware.
 *
 *
 * Use cases:
 *   - Debug a chef's "why don't I see this shift?" by viewing as them
 *   - Verify client portal looks right before activating their access
 *   - Repro bugs reported by users
 *
 * Implementation:
 *   - super_admin POSTs to /api/impersonate/[userId]
 *   - Server sets two HttpOnly cookies:
 *       cs_impersonate_target=<targetUserId>     (the user to act as)
 *       cs_impersonate_actor=<super_admin_id>    (so we know who's behind it)
 *   - Subsequent requests: a server helper `effectiveSession()` reads these
 *     cookies and returns the target user's session data (loaded from DB)
 *     while preserving the actor info for audit-logging.
 *   - Banner component on every page shows "Impersonating: <name> — stop"
 *   - "Stop impersonating" clears cookies, returns to super_admin session
 *
 * Audit:
 *   - Every impersonation start writes to audit_log: impersonation.start
 *   - Stop writes: impersonation.stop
 *   - Mutations DURING impersonation tag audit_log with actor_id field
 *     (we already capture this — actingUserId in server actions is the
 *     impersonator's own id, the audit entry shows what was done as which user)
 *
 * Safety:
 *   - Cookies are HttpOnly + SameSite=Lax + Secure (production)
 *   - Only super_admin can START — middleware checks the actor cookie was set
 *     by a super_admin during this Auth.js session
 *   - Cannot impersonate another super_admin (prevents privilege confusion)
 *   - Auto-expire after 1 hour
 */

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, roles, userRoles, users } from "@/lib/db/schema";

import type { Session } from "next-auth";

const IMPERSONATE_TARGET = "cs_impersonate_target";
const IMPERSONATE_ACTOR = "cs_impersonate_actor";
const COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1 hour

export async function startImpersonation(
  targetUserId: string,
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (targetUserId === actorUserId) {
    return { ok: false, error: "Cannot impersonate yourself" };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });
  if (!target) return { ok: false, error: "Target user not found" };

  // Don't allow impersonating another super_admin (defence in depth)
  const targetRoles = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, targetUserId));
  if (targetRoles.some((r) => r.key === "super_admin")) {
    return { ok: false, error: "Cannot impersonate another super_admin" };
  }

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_TARGET, targetUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  cookieStore.set(IMPERSONATE_ACTOR, actorUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  await db.insert(auditLog).values({
    userId: actorUserId,
    action: "impersonation.start",
    resource: "users",
    resourceId: targetUserId,
    after: { targetEmail: target.email, targetKind: target.kind },
  });

  return { ok: true };
}

export async function stopImpersonation(): Promise<void> {
  const cookieStore = await cookies();
  const target = cookieStore.get(IMPERSONATE_TARGET)?.value;
  const actor = cookieStore.get(IMPERSONATE_ACTOR)?.value;

  cookieStore.delete(IMPERSONATE_TARGET);
  cookieStore.delete(IMPERSONATE_ACTOR);

  if (target && actor) {
    await db.insert(auditLog).values({
      userId: actor,
      action: "impersonation.stop",
      resource: "users",
      resourceId: target,
    });
  }
}

/** Returns active impersonation if any (server-only). */
export async function getImpersonation(): Promise<{
  targetUserId: string;
  actorUserId: string;
} | null> {
  const cookieStore = await cookies();
  const target = cookieStore.get(IMPERSONATE_TARGET)?.value;
  const actor = cookieStore.get(IMPERSONATE_ACTOR)?.value;
  if (!target || !actor) return null;
  return { targetUserId: target, actorUserId: actor };
}

/* ----- effective session overlay (Phase B) -------------------------------- */

/**
 * Overlay impersonation onto the REAL session. Returns a session shaped as the
 * target user (tagged `impersonator`) ONLY when every guard holds; otherwise
 * returns `real` unchanged. Defensive by construction: any missing cookie,
 * mismatch, or error → the real session, so normal login is never affected.
 *
 * Guards: real user is super_admin · actor cookie == real user id · target
 * exists + `status='active'` + is NOT super_admin. `requireAuth`/`requireRole`
 * call this so the whole app resolves the effective user from one place
 * (we never touch the Auth.js JWT callback).
 */
export async function applyImpersonation(real: Session | null): Promise<Session | null> {
  if (!real?.user) return real;
  if (!real.user.roles?.includes("super_admin")) return real;
  try {
    const imp = await getImpersonation();
    if (!imp) return real;
    if (imp.actorUserId !== real.user.id) return real;

    const target = await db.query.users.findFirst({
      where: eq(users.id, imp.targetUserId),
    });
    if (!target || target.status !== "active") return real;

    const targetRoleRows = await db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, target.id));
    const roleKeys = targetRoleRows.map((r) => r.key);
    if (roleKeys.includes("super_admin")) return real; // never impersonate a super_admin

    return {
      ...real,
      user: {
        ...real.user,
        id: target.id,
        email: target.email,
        name: target.name,
        kind: target.kind,
        roles: roleKeys,
        totpEnabled: Boolean(target.totpEnabled),
        hasPassword: Boolean(target.passwordHash),
        impersonator: { id: real.user.id, name: real.user.name ?? null },
      },
    };
  } catch {
    return real; // safe fallback — impersonation never breaks a real session
  }
}

/**
 * Phase B1 view-only guard. Mutating server actions reachable while
 * impersonating (chef/client portal actions) call this so writes are blocked
 * until B2 wires `recordAudit` (which records the impersonator on every write).
 * Throws `IMPERSONATION_VIEW_ONLY`; callers surface a "stop bekijk-als" message.
 */
export function assertNotImpersonating(session: Session): void {
  if (session.user.impersonator) {
    throw new Error("IMPERSONATION_VIEW_ONLY");
  }
}
