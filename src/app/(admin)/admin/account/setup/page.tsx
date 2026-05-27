/**
 * Setup wizard orchestrator — PR-S2D.
 *
 * Internal users are bounced here by middleware until they have both a
 * password AND TOTP enrolled. This page picks the next incomplete step.
 *
 * Order:
 *   1. Set password (block on missing password_hash)
 *   2. Scan TOTP QR + verify code (block on missing totp_enabled)
 *   3. Save recovery codes (block on cs_2fa_setup_codes cookie present)
 *
 * If everything is complete → bounce to user's default landing.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { defaultLandingFor, requireAuth } from "@/lib/permissions";

export const metadata = { title: "Setup", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SetupOrchestrator() {
  const session = await requireAuth("/admin/account/setup");

  const [u] = await db
    .select({
      passwordHash: users.passwordHash,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!u) redirect("/login");

  if (!u.passwordHash) {
    redirect("/admin/account/setup/password");
  }
  if (!u.totpEnabled) {
    redirect("/admin/account/setup/2fa");
  }

  // Recovery codes pending display?
  const cookieStore = await cookies();
  if (cookieStore.get("cs_2fa_codes")?.value) {
    redirect("/admin/account/setup/codes");
  }

  // All done — go to the default landing.
  redirect(defaultLandingFor(session.user.roles ?? []));
}
