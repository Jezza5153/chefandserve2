/**
 * Auth.js v5 configuration — magic-link via Resend, Drizzle adapter, JWT sessions.
 *
 * Key rules (founder spec, see BUILD_PLAN.md):
 *   - Seed-only login: signIn callback rejects unknown emails or status != 'active'
 *   - JWT carries userId, kind, roles[], permissionsVersion
 *   - On every JWT use we re-check permissionsVersion against DB to invalidate
 *     stale tokens after role changes (no waiting for token expiry)
 *   - signIn event writes to audit_log
 */

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { Resend } from "resend";

import { db } from "@/lib/db/client";
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  auditLog,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/passwords";
import { verifyAndConsume } from "@/lib/recovery-codes";
import { decryptSecret, verifyCode } from "@/lib/totp";

import { MagicLinkEmail } from "@/emails/MagicLinkEmail";

const resend = new Resend(env.RESEND_API_KEY);

/* ---------- helpers --------------------------------------------------- */

async function loadUserWithRoles(email: string) {
  const lowered = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, lowered))
    .limit(1);

  if (!user) return null;

  const roleRows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));

  return {
    ...user,
    roles: roleRows.map((r) => r.key),
  };
}

/* ---------- config ---------------------------------------------------- */

export const authConfig: NextAuthConfig = {
  // We re-implement the Resend provider inline so we can use our own
  // React Email template instead of Auth.js's default plain HTML.
  providers: [
    // PR-S2E — primary login flow for internal staff after wizard:
    // email + password + TOTP code (or single-use recovery code).
    Credentials({
      id: "password-totp",
      name: "Password + 2FA",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "2FA code", type: "text" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const totpRaw = String(credentials?.totp ?? "").trim();

        if (!email || !password || !totpRaw) return null;

        const dbUser = await loadUserWithRoles(email);
        if (!dbUser) return null;
        if (dbUser.status !== "active") return null;
        if (!dbUser.passwordHash || !dbUser.totpSecretEncrypted) return null;

        // 1. Verify password (bcrypt, constant-time-ish)
        const pwOk = await verifyPassword(password, dbUser.passwordHash);
        if (!pwOk) return null;

        // 2. Verify TOTP. Try numeric code first, fall back to recovery code.
        let totpOk = false;
        const cleaned = totpRaw.replace(/\s+/g, "");
        if (/^\d{6}$/.test(cleaned)) {
          try {
            const secret = await decryptSecret(dbUser.totpSecretEncrypted);
            totpOk = verifyCode(secret, cleaned);
          } catch {
            totpOk = false;
          }
        }
        if (!totpOk) {
          // Recovery code path — atomic single-use consume
          totpOk = await verifyAndConsume(dbUser.id, totpRaw);
        }
        if (!totpOk) return null;

        // Audit (best-effort)
        await db
          .insert(auditLog)
          .values({
            userId: dbUser.id,
            action: "auth.password_signin",
            resource: "users",
            resourceId: dbUser.id,
          })
          .catch(() => {});

        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name ?? null,
        };
      },
    }),
    {
      id: "resend",
      name: "Resend",
      type: "email",
      maxAge: 60 * 15, // 15-minute token lifetime
      from: env.RESEND_FROM_EMAIL,
      sendVerificationRequest: async ({ identifier, url }) => {
        // Pre-send gate: only send if the address belongs to an active
        // seeded user. Prevents (a) leaking which emails exist via
        // delivery vs no-delivery, and (b) burning Resend quota on spam.
        // The token is still saved in DB by the adapter — that's fine,
        // it's useless without the email link, and signIn callback would
        // reject it anyway.
        const dbUser = await loadUserWithRoles(identifier);
        if (!dbUser || dbUser.status !== "active") {
          // Silent skip — DO NOT throw. Caller still gets a clean redirect
          // to /verify, so the UI feedback is identical for known vs unknown
          // emails (no enumeration).
          return;
        }

        const result = await resend.emails.send({
          from: env.RESEND_FROM_EMAIL,
          to: identifier,
          subject: "Je inloglink voor Chef & Serve",
          react: MagicLinkEmail({
            url,
            recipientEmail: identifier,
          }),
        });
        if (result.error) {
          throw new Error(
            `Resend failed to send magic link: ${result.error.message}`,
          );
        }
      },
    },
  ],

  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  }),

  // JWT strategy — no DB lookup on every request (cheaper than DB sessions)
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 }, // 7-day rolling

  secret: env.AUTH_SECRET,

  pages: {
    signIn: "/login",
    verifyRequest: "/verify",
    error: "/login",
  },

  callbacks: {
    /**
     * Gatekeeper. Auth.js calls this AFTER the user clicks the magic link
     * and the email is verified, but BEFORE we issue a session. Returning
     * false aborts the sign-in.
     *
     * Rule: only seeded `internal` users with status='active' may log in.
     * Unknown emails and 'invited'/'disabled' users are rejected.
     */
    async signIn({ user }) {
      if (!user.email) return false;
      const dbUser = await loadUserWithRoles(user.email);
      if (!dbUser) return false; // unknown email — block, no auto-create
      if (dbUser.status !== "active") return false; // invited/disabled — block
      return true;
    },

    /**
     * JWT enrichment + permissionsVersion invalidation.
     *
     * First sign-in: load user from DB, embed roles + permissionsVersion.
     * Subsequent requests: re-check permissionsVersion to detect role changes.
     */
    async jwt({ token, user, trigger }) {
      if (user?.email) {
        const dbUser = await loadUserWithRoles(user.email);
        if (!dbUser) return null; // shouldn't happen post signIn callback
        token.userId = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name ?? null;
        token.kind = dbUser.kind;
        token.roles = dbUser.roles;
        token.permissionsVersion = dbUser.permissionsVersion;
        token.totpEnabled = Boolean(dbUser.totpEnabled);
        token.hasPassword = Boolean(dbUser.passwordHash);
        return token;
      }

      // Existing JWT — verify it's still valid by checking permissionsVersion
      if (token.userId && typeof token.userId === "string") {
        const [current] = await db
          .select({
            permissionsVersion: users.permissionsVersion,
            status: users.status,
            totpEnabled: users.totpEnabled,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.id, token.userId))
          .limit(1);

        // User gone, disabled, or permissions changed → invalidate token
        if (
          !current ||
          current.status !== "active" ||
          current.permissionsVersion !== token.permissionsVersion
        ) {
          return null; // forces re-login
        }
        // Keep the gate flags fresh on every JWT read so setup-completion
        // and 2FA toggles reflect without waiting for a permissionsVersion bump.
        token.totpEnabled = Boolean(current.totpEnabled);
        token.hasPassword = Boolean(current.passwordHash);
      }

      // refresh user data periodically
      if (trigger === "update" && token.email && typeof token.email === "string") {
        const refreshed = await loadUserWithRoles(token.email);
        if (refreshed) {
          token.roles = refreshed.roles;
          token.permissionsVersion = refreshed.permissionsVersion;
          token.totpEnabled = Boolean(refreshed.totpEnabled);
          token.hasPassword = Boolean(refreshed.passwordHash);
        }
      }

      return token;
    },

    /**
     * Expose useful fields on the session object (server + client).
     * Never expose individual permissions — the client only needs role names.
     */
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = (token.userId as string) ?? "";
        // Explicitly forward email/name from the JWT — Auth.js v5 doesn't
        // auto-merge them when the session callback returns a custom shape.
        // Without this, pages that read session.user.email (e.g. the 2FA
        // setup page's QR provisioning URI) crash on first render after
        // sign-in because the non-null assertion hits undefined.
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.name === "string" || token.name === null) {
          session.user.name = token.name;
        }
        session.user.kind = (token.kind as "internal" | "chef" | "client") ?? "internal";
        session.user.roles = (token.roles as string[]) ?? [];
        session.user.permissionsVersion =
          (token.permissionsVersion as number) ?? 1;
        session.user.totpEnabled = Boolean(token.totpEnabled);
        session.user.hasPassword = Boolean(token.hasPassword);
      }
      return session;
    },
  },

  events: {
    /**
     * Audit-log every successful sign-in. The IP/UA aren't available in the
     * event — they live on the request that triggered the sign-in. We log
     * what we have; PR-0F's middleware can enrich audit_log with IP/UA via
     * a wrapper helper.
     */
    async signIn({ user }) {
      if (!user?.id) return;
      await db.insert(auditLog).values({
        userId: user.id,
        action: "auth.signin",
        resource: "users",
        resourceId: user.id,
      });
    },
  },

  trustHost: true, // Vercel sets X-Forwarded-Host; trust it
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
