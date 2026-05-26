import { redirect } from "next/navigation";

import { defaultLandingFor, requireAuth } from "@/lib/permissions";

/**
 * Admin index — role-based redirect.
 *
 * super_admin → /admin/system
 * owner       → /admin/business
 * other       → /admin/business (fallback)
 */
export default async function AdminIndex() {
  const session = await requireAuth();
  redirect(defaultLandingFor(session.user.roles));
}
