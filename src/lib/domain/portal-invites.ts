/**
 * Portal-invite flow.
 *
 * "Invite to portal" = create a User row for a chef or client, link it via
 * chef.userId / client.userId, and (when activated) send the PortalInviteEmail
 * so they know they can log in.
 *
 * Two-step by design:
 *   1. inviteChefToPortal(chefId, actingUserId)
 *      → creates User(email=chef.email, kind='chef', status='invited')
 *      → links chefs.userId
 *      → audit-logs
 *      → DOES NOT email yet (status='invited' = can't log in)
 *
 *   2. activatePortalUser(userId, actingUserId)
 *      → flips status to 'active'
 *      → sends PortalInviteEmail to chef/client
 *      → audit-logs
 *
 * Why two steps: Maarten reviews the invite before activating. Catches typos
 * in email addresses, lets Maarten coordinate (e.g. tell chef in person
 * before they get an email out of nowhere).
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { assertImpersonationAllowed } from "@/lib/domain/impersonation";
import {
  recordAuditCore,
  recordAuditFromRequest,
  stampFromRequest,
} from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefs,
  clients,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { env } from "@/lib/env";
import { PortalInviteEmail } from "@/emails/PortalInviteEmail";

export type InviteResult =
  | { ok: true; userId: string; alreadyExisted: boolean }
  | { ok: false; error: string };

export async function inviteChefToPortal(
  chefId: string,
  actingUserId: string,
): Promise<InviteResult> {
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  if (!chef) return { ok: false, error: "Chef not found" };
  if (!chef.email) {
    return {
      ok: false,
      error: "Chef heeft geen e-mailadres. Voeg er een toe op het profiel.",
    };
  }

  // Idempotent: re-invite returns existing user
  if (chef.userId) {
    return { ok: true, userId: chef.userId, alreadyExisted: true };
  }

  // Check if a user already exists with this email (shouldn't, but defensive)
  const existing = await db.query.users.findFirst({
    where: eq(users.email, chef.email.toLowerCase()),
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
    // If user exists but isn't of kind=chef, that's an error — same email
    // already used as internal / client / etc.
    if (existing.kind !== "chef") {
      return {
        ok: false,
        error: `E-mail ${chef.email} bestaat al als ${existing.kind}-account.`,
      };
    }
  } else {
    const [newUser] = await db
      .insert(users)
      .values({
        email: chef.email.toLowerCase(),
        name: chef.fullName,
        kind: "chef",
        status: "invited",
      })
      .returning({ id: users.id });
    userId = newUser.id;
  }

  // Link chef.userId
  await db
    .update(chefs)
    .set({ userId, updatedAt: new Date() })
    .where(eq(chefs.id, chefId));

  await recordAuditFromRequest({
    userId: actingUserId,
    action: "portal.invite",
    resource: "users",
    resourceId: userId,
    after: { chefId, email: chef.email, kind: "chef" },
  });

  return { ok: true, userId, alreadyExisted: false };
}

export async function inviteClientToPortal(
  clientId: string,
  actingUserId: string,
): Promise<InviteResult> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
  });
  if (!client) return { ok: false, error: "Klant niet gevonden" };
  if (!client.email) {
    return {
      ok: false,
      error: "Klant heeft geen e-mailadres. Voeg er een toe op het profiel.",
    };
  }

  if (client.userId) {
    return { ok: true, userId: client.userId, alreadyExisted: true };
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, client.email.toLowerCase()),
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (existing.kind !== "client") {
      return {
        ok: false,
        error: `E-mail ${client.email} bestaat al als ${existing.kind}-account.`,
      };
    }
  } else {
    const [newUser] = await db
      .insert(users)
      .values({
        email: client.email.toLowerCase(),
        name: client.contactName ?? client.companyName,
        kind: "client",
        status: "invited",
      })
      .returning({ id: users.id });
    userId = newUser.id;
  }

  await db
    .update(clients)
    .set({ userId, updatedAt: new Date() })
    .where(eq(clients.id, clientId));

  await recordAuditFromRequest({
    userId: actingUserId,
    action: "portal.invite",
    resource: "users",
    resourceId: userId,
    after: { clientId, email: client.email, kind: "client" },
  });

  return { ok: true, userId, alreadyExisted: false };
}

/**
 * Activate an invited user — flips status to active + sends the
 * PortalInviteEmail so they know they can log in.
 */
export type ActivateResult =
  | { ok: true; emailSent: boolean; emailError?: string }
  | { ok: false; error: string };

export async function activatePortalUser(
  userId: string,
  actingUserId: string,
): Promise<ActivateResult> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { ok: false, error: "Gebruiker niet gevonden" };
  if (user.status === "active") return { ok: true, emailSent: false }; // already active, no-op

  await db
    .update(users)
    .set({
      status: "active",
      permissionsVersion: user.permissionsVersion + 1, // bump so any cached JWTs invalidate
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await recordAuditFromRequest({
    userId: actingUserId,
    action: "users.activate",
    resource: "users",
    resourceId: userId,
  });

  // Activation already succeeded. We DON'T block on the welcome email, but we DO report
  // whether it actually sent — so the admin is never left thinking it went out when it
  // did not (the silent-failure trap this fix closes).
  if (!user.email) return { ok: true, emailSent: false, emailError: "geen e-mailadres bekend" };
  if (user.kind === "internal") return { ok: true, emailSent: false };

  let emailSent = false;
  let emailError: string | undefined;
  try {
    const send = await sendEmail({
      to: user.email,
      subject:
        user.kind === "chef"
          ? "Welkom bij Chef & Serve — toegang tot je chef-portaal"
          : "Welkom bij Chef & Serve — toegang tot je klant-portaal",
      react: PortalInviteEmail({
        recipientName: user.name ?? user.email,
        recipientKind: user.kind as "chef" | "client",
        loginUrl: `${env.NEXT_PUBLIC_APP_URL}/login`,
      }),
    });
    if (send.ok) {
      emailSent = true;
      // PR-AUDIT-4: track the welcome/invite send.
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: user.email,
        template: "PortalInviteEmail",
        eventKey: "portal_invite",
        entityType: "users",
        entityId: userId,
        userId,
      });
    } else {
      emailError = send.error;
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }

  // A failed send has no provider id, so it can't go in email_messages — record it in
  // the audit log instead, so the failure is visible (not a console line that dies in prod).
  if (!emailSent) {
    console.error("[activate] invite email NOT sent:", emailError);
    await recordAuditFromRequest({
      userId: actingUserId,
      action: "portal.invite_email_failed",
      resource: "users",
      resourceId: userId,
      after: { emailError, toEmail: user.email },
    }).catch(() => {});
  }

  return { ok: true, emailSent, emailError };
}

/**
 * PR-A: invite a new internal staff member.
 *
 * Creates a user row with kind=internal, status=active (skips the
 * "invited" pause used for chef/client), links the user_role row for
 * the requested role, and sends a PortalInviteEmail with internal copy.
 *
 * The forced setup wizard in middleware takes care of the actual
 * security: invited user can ONLY reach /admin/account/setup/* until
 * they've set password + 2FA + saved recovery codes.
 *
 * Authority check is the caller's responsibility — invoking server
 * action must verify `requireRole("super_admin")` first.
 */
export async function inviteInternalStaff(args: {
  email: string;
  name: string;
  /** any seeded role key (existence is validated below). */
  role: string;
  actingUserId: string;
}): Promise<InviteResult> {
  await assertImpersonationAllowed();
  const email = args.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Ongeldig e-mailadres" };
  }
  if (!args.name.trim()) {
    return { ok: false, error: "Naam is verplicht" };
  }

  // Check for an existing user
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    if (existing.kind !== "internal") {
      return {
        ok: false,
        error: `E-mail ${email} bestaat al als ${existing.kind}-account.`,
      };
    }
    // Already an internal user — short-circuit
    return { ok: true, userId: existing.id, alreadyExisted: true };
  }

  // Lookup the role row
  const roleRow = await db.query.roles.findFirst({
    where: eq(roles.key, args.role),
  });
  if (!roleRow) {
    return { ok: false, error: `Rol '${args.role}' bestaat niet` };
  }

  const auditBase = await stampFromRequest({
    userId: args.actingUserId,
    action: "users.invite_internal",
    resource: "users",
    after: { email, name: args.name.trim(), role: args.role },
  });

  // Atomic: create the user (active immediately — wizard middleware gates
  // access) + link the role + audit, all in one transaction.
  const newUserId = await withTx(async (tx) => {
    const [newUser] = await tx
      .insert(users)
      .values({
        email,
        name: args.name.trim(),
        kind: "internal",
        status: "active",
      })
      .returning({ id: users.id });

    await tx.insert(userRoles).values({
      userId: newUser.id,
      roleId: roleRow.id,
      grantedBy: args.actingUserId,
    });

    await recordAuditCore({ ...auditBase, resourceId: newUser.id }, tx);
    return newUser.id;
  });

  // Best-effort invite email (post-commit).
  try {
    const send = await sendEmail({
      to: email,
      subject: "Welkom bij Chef & Serve — toegang tot het medewerker-portaal",
      react: PortalInviteEmail({
        recipientName: args.name.trim(),
        recipientKind: "internal",
        loginUrl: `${env.NEXT_PUBLIC_APP_URL}/login`,
      }),
    });
    // PR-AUDIT-4: track the internal-staff invite send.
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: email,
        template: "PortalInviteEmail",
        eventKey: "portal_invite",
        entityType: "users",
        entityId: newUserId,
        userId: newUserId,
      });
    }
  } catch (e) {
    console.error("[invite-internal] email failed:", e);
  }

  return { ok: true, userId: newUserId, alreadyExisted: false };
}

/** Disable a portal user (keeps the row, blocks login). */
export async function disablePortalUser(
  userId: string,
  actingUserId: string,
): Promise<{ ok: true }> {
  await assertImpersonationAllowed();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { ok: true };

  const auditBase = await stampFromRequest({
    userId: actingUserId,
    action: "users.disable",
    resource: "users",
    resourceId: userId,
  });
  // Atomic: disable + bump permissionsVersion (kills sessions) + audit together.
  await withTx(async (tx) => {
    await tx
      .update(users)
      .set({
        status: "disabled",
        permissionsVersion: user.permissionsVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await recordAuditCore(auditBase, tx);
  });

  return { ok: true };
}
