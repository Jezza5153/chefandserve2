/**
 * Type augmentations for Auth.js session + JWT.
 *
 * Lets us read session.user.roles / session.user.kind / session.user.id
 * with proper typing across the app.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      kind: "internal" | "chef" | "client";
      roles: string[];
      permissionsVersion: number;
      /** PR-S2A/B — middleware reads this to decide whether to gate on /verify-2fa. */
      totpEnabled: boolean;
      /** PR-S2D — middleware reads this to force the setup wizard until password is set. */
      hasPassword: boolean;
      /** PR-C0 — embedded in cs_2fa_verified cookie so admin reset invalidates it. */
      totpEnrolledAtMs: number | null;
      /**
       * Which provider established this session: "resend" (magic link) or
       * "password-totp" (password + 2FA). The middleware treats a magic-link
       * session as 2FA-satisfied (email possession IS the factor) so it skips
       * the /verify-2fa gate; the password path still carries its TOTP.
       */
      loginMethod?: string | null;
      /**
       * Phase B impersonation — set ONLY on an effective (impersonated) session
       * by `applyImpersonation`. Present = a super_admin is viewing AS this user.
       * `null`/absent on every normal session. Phase B1 = view-only (writes 403).
       */
      impersonator?: { id: string; name: string | null } | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    email?: string;
    name?: string | null;
    kind?: "internal" | "chef" | "client";
    roles?: string[];
    permissionsVersion?: number;
    totpEnabled?: boolean;
    hasPassword?: boolean;
    totpEnrolledAtMs?: number | null;
    /** Provider that established the session ("resend" = magic link). */
    loginMethod?: string | null;
  }
}
