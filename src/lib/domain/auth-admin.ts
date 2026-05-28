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
