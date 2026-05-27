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
  }
}
