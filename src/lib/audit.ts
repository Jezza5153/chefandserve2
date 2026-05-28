/**
 * Canonical audit writer — two entry points (C0 gate 2).
 *
 *   - `recordAuditCore(values, conn?)` — PURE. Never imports `next/headers`.
 *     Safe in ANY runtime (worker / cron / script / request). Inserts one
 *     `audit_log` row exactly as given. Accepts an optional db/tx connection
 *     (defaults to the shared `db`) for callers that already hold one.
 *
 *   - `recordAuditFromRequest(values)` — REQUEST-SCOPED. Reads the active
 *     impersonation cookies and stamps:
 *       · `impersonatorUserId` — the real super_admin behind a `Bekijk als`
 *       · `after._imp`         — the impersonation session id (correlates
 *                                 start → every write → stop for forensics)
 *     then delegates to core. Use this from server actions / route handlers so
 *     every mutation records BOTH the acting user (`userId`, the TARGET during
 *     impersonation) AND the real super_admin — the "who really did it?"
 *     guarantee. Outside a request scope the cookie reads no-op.
 *
 * Worker safety (C0 gate 2): workers / cron MUST NOT import
 * `recordAuditFromRequest` (it pulls `next/headers`). They call
 * `recordAuditCore` or keep a direct insert annotated
 * `// AUDIT_DIRECT_ALLOWED: <reason>`.
 */

import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

// Mirror of the cookie names in src/lib/domain/impersonation.ts (server-set only).
const IMPERSONATE_ACTOR_COOKIE = "cs_impersonate_actor";
const IMPERSONATE_SID_COOKIE = "cs_impersonate_sid";

export type AuditValues = {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  impersonatorUserId?: string | null;
};

/** Minimal connection shape — the shared `db` (or a future tx) satisfies this. */
type AuditConn = Pick<typeof db, "insert">;

/**
 * PURE audit writer. No `next/headers`, safe in any runtime. Inserts exactly
 * what it is given — no impersonation inference. Pass a `conn` to write through
 * a specific connection; defaults to the shared pooled `db`.
 */
export async function recordAuditCore(
  values: AuditValues,
  conn: AuditConn = db,
): Promise<void> {
  await conn.insert(auditLog).values(values);
}

/**
 * Request-scoped audit writer. Derives the impersonator + session id from the
 * server-set cookies (never from caller input, so they cannot be spoofed) and
 * stamps them before delegating to {@link recordAuditCore}. Always `await`ed by
 * callers — a failure throws and aborts the mutation (fail-closed, C0 gate 3).
 */
export async function recordAuditFromRequest(values: AuditValues): Promise<void> {
  let impersonatorUserId: string | null = null;
  let sessionId: string | null = null;
  try {
    const store = await cookies();
    impersonatorUserId = store.get(IMPERSONATE_ACTOR_COOKIE)?.value ?? null;
    sessionId = store.get(IMPERSONATE_SID_COOKIE)?.value ?? null;
  } catch {
    // No request scope (e.g. called from a worker) — leave both null.
  }

  // Only stamp `after._imp` while genuinely impersonating, so normal writes
  // keep a clean `after` payload (matrix item 19).
  const after =
    impersonatorUserId && sessionId
      ? stampImpersonationSession(values.after, sessionId)
      : values.after;

  await recordAuditCore({ ...values, after, impersonatorUserId });
}

/** Merge `_imp` into the `after` JSON without clobbering existing keys. */
function stampImpersonationSession(after: unknown, sessionId: string): unknown {
  if (after === null || after === undefined) {
    return { _imp: sessionId };
  }
  if (typeof after === "object" && !Array.isArray(after)) {
    return { ...(after as Record<string, unknown>), _imp: sessionId };
  }
  // Non-object `after` (string / number / array) — wrap so we lose nothing.
  return { _value: after, _imp: sessionId };
}
