/**
 * Canonical audit writer (Phase B2).
 *
 * Drop-in for `db.insert(auditLog).values({...})` — same shape — but it ALSO
 * stamps `impersonatorUserId` from the active impersonation cookie. So any
 * mutation routed through this records BOTH the acting user (`userId`, the
 * target during impersonation) AND the real super_admin behind it. This is the
 * "who really did it?" guarantee for `Bekijk als`.
 *
 * Reading the cookie directly (not the session) keeps it usable from any server
 * action/route without plumbing the session through. Outside a request scope
 * (workers/scripts) the cookie read no-ops → `impersonatorUserId` stays null.
 */

import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

// Mirror of IMPERSONATE_ACTOR in src/lib/domain/impersonation.ts (set server-side only).
const IMPERSONATE_ACTOR_COOKIE = "cs_impersonate_actor";

type AuditValues = {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(values: AuditValues): Promise<void> {
  let impersonatorUserId: string | null = null;
  try {
    const store = await cookies();
    impersonatorUserId = store.get(IMPERSONATE_ACTOR_COOKIE)?.value ?? null;
  } catch {
    // no request scope (e.g. a worker) — leave null
  }
  await db.insert(auditLog).values({ ...values, impersonatorUserId });
}
