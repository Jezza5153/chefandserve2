/**
 * Recovery orchestration — PR-C.
 *
 * One entry per intent. Each:
 *   1. Looks up the user (lowered email, exact match)
 *   2. Confirms they are internal + active (otherwise silent no-op)
 *   3. Mints a recovery intent token (15 min, single-use)
 *   4. Sends RecoveryEmail with /recover/<intent>?token=<token>
 *   5. Audit-logs auth.recovery_requested
 *
 * Important: NEVER throw for unknown email + NEVER reveal known/unknown via
 * a different return shape. The caller redirects the user to the same /verify
 * page regardless. Email enumeration would let attackers map active internal
 * staff addresses.
 *
 * Why "internal only": chefs and klanten authenticate purely via magic-link;
 * they have no password and no TOTP to recover. Exposing recovery for those
 * kinds would just leak the email-exists signal.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { createIntent, type RecoveryIntentKind } from "@/lib/recovery-intents";

import { RecoveryEmail } from "@/emails/RecoveryEmail";

export async function requestRecovery(args: {
  email: string;
  intent: RecoveryIntentKind;
  /** Full origin like https://chefandserve.vercel.app — comes from headers().host. */
  origin: string;
}): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return; // silent no-op for invalid input

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      kind: users.kind,
      status: users.status,
      totpEnabled: users.totpEnabled,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Silent for unknown email — same UI feedback as known/unknown.
  if (!user) return;

  // Recovery only makes sense for internal users with the relevant credential
  // already set up. For password recovery we need them to have password +
  // TOTP (otherwise nothing to recover OR no 2nd factor to require). For
  // TOTP recovery we need TOTP to actually be enabled.
  if (user.kind !== "internal") return;
  if (user.status !== "active") return;
  if (args.intent === "password" && (!user.passwordHash || !user.totpEnabled)) {
    return;
  }
  if (args.intent === "totp" && !user.totpEnabled) return;

  const token = await createIntent(user.id, args.intent);
  const path = args.intent === "password" ? "/recover/password" : "/recover/2fa";
  const recoveryUrl = `${args.origin.replace(/\/+$/, "")}${path}?token=${token}`;

  const send = await sendEmail({
    to: user.email,
    subject:
      args.intent === "password"
        ? "Herstel je wachtwoord voor Chef & Serve"
        : "Herstel je 2FA voor Chef & Serve",
    react: RecoveryEmail({
      recipientName: user.name ?? user.email,
      intent: args.intent,
      recoveryUrl,
    }),
  });

  // Best-effort audit. We log SUCCESS distinctly from REQUEST so an attacker
  // brute-forcing emails can't tell which got delivered (they only see the
  // /verify redirect, never the audit log).
  await recordAuditFromRequest({
    userId: user.id,
    action: "auth.recovery_requested",
    resource: "users",
    resourceId: user.id,
    after: {
      intent: args.intent,
      emailSent: send.ok,
      // Keep the email logged purely for forensics on the user's own row.
      targetEmail: user.email,
    },
  })
    .catch(() => {});

  // Resend handles its own quota; don't surface errors to caller. The plan
  // is to let the /verify generic-success page tell the user "check your
  // inbox" regardless of whether send succeeded — they re-try if no mail.
}
