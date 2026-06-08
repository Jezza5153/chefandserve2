/**
 * Admin-initiated auth actions — PR-C0.
 *
 * Used by /admin/system/users/[id] AND by scripts/reset-internal-2fa.ts.
 *
 * resetInternalUser2FA(targetUserId, actingUserId):
 *   1. Clears totp_secret_encrypted, totp_enabled, totp_enrolled_at
 *   2. Deletes all user_recovery_codes rows for the user
 *   3. Bumps permissions_version → invalidates the target's JWT on next
 *      request (jwt callback returns null on mismatch)
 *   4. Audit row auth.totp_reset_by_admin with actor + target
 *
 * After this, the target's next request:
 *   - jwt callback re-reads permissions_version → mismatch → returns null
 *   - session is null → middleware redirects to /login
 *   - target re-authenticates → fresh JWT has totpEnabled=false + null
 *     enrolledAt
 *   - middleware bounces to /admin/account/setup/2fa for re-enrollment
 *   - even if any other browser had a v2 cookie with the OLD enrolledAtMs,
 *     the cookie validator now rejects it because the user record has
 *     enrolledAt=null
 *
 * Authority check is the caller's responsibility (requireRole("super_admin")).
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { userRecoveryCodes, users } from "@/lib/db/schema";

export type ResetResult =
  | { ok: true; affectedUserId: string }
  | { ok: false; error: string };

export async function resetInternalUser2FA(args: {
  targetUserId: string;
  actingUserId: string;
}): Promise<ResetResult> {
  const target = await db.query.users.findFirst({
    where: eq(users.id, args.targetUserId),
  });
  if (!target) return { ok: false, error: "Doel-gebruiker niet gevonden" };
  if (target.kind !== "internal") {
    return {
      ok: false,
      error: "Alleen 2FA voor interne medewerkers kan worden gereset",
    };
  }

  await db
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      permissionsVersion: target.permissionsVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id));

  await db
    .delete(userRecoveryCodes)
    .where(eq(userRecoveryCodes.userId, target.id));

  await recordAuditFromRequest({
    userId: args.actingUserId,
    action: "auth.totp_reset_by_admin",
    resource: "users",
    resourceId: target.id,
    after: {
      targetEmail: target.email,
      selfReset: args.actingUserId === target.id,
    },
  });

  return { ok: true, affectedUserId: target.id };
}

export type ChangeEmailResult =
  | { ok: true; affectedUserId: string; oldEmail: string; newEmail: string }
  | { ok: false; error: string };

/**
 * Change a user's LOGIN e-mail (the `users.email` identity used for magic-link /
 * password login) — admin-initiated, super_admin only (caller gates it).
 *
 * Normalizes to lowercase (the `users_email_lowercase` CHECK enforces it),
 * rejects a clash with another account (the column is UNIQUE), then:
 *   - sets the new e-mail + clears `email_verified` (the new address is
 *     unproven until they next use it)
 *   - bumps `permissions_version` → invalidates the target's JWT on their next
 *     request, so any live session is logged out and re-authenticates with the
 *     new address (no stale e-mail claim left in a token)
 *   - audits before/after so the identity change is traceable
 *
 * Note: this changes the LOGIN identity only. For chefs/clients the contact
 * e-mail on `chefs`/`clients` is a separate field, edited on their detail page.
 * `seed_key` keeps seeded rows identifiable after the e-mail changes.
 */
export async function changeUserLoginEmail(args: {
  targetUserId: string;
  newEmail: string;
  actingUserId: string;
}): Promise<ChangeEmailResult> {
  const email = args.newEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Ongeldig e-mailadres" };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, args.targetUserId),
  });
  if (!target) return { ok: false, error: "Doel-gebruiker niet gevonden" };
  if (target.email === email) {
    return { ok: false, error: "Dit is al het huidige e-mailadres" };
  }

  // UNIQUE column — reject a clash with a different account before we try (so
  // the user sees a friendly message, not a Postgres constraint error).
  const clash = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (clash && clash.id !== target.id) {
    return {
      ok: false,
      error: `E-mail ${email} is al in gebruik door een ander account.`,
    };
  }

  const oldEmail = target.email;
  await db
    .update(users)
    .set({
      email,
      emailVerified: null,
      permissionsVersion: target.permissionsVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id));

  await recordAuditFromRequest({
    userId: args.actingUserId,
    action: "users.email_changed_by_admin",
    resource: "users",
    resourceId: target.id,
    before: { email: oldEmail },
    after: { email, selfChange: args.actingUserId === target.id },
  });

  return { ok: true, affectedUserId: target.id, oldEmail, newEmail: email };
}
