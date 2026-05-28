/**
 * Impersonation destructive denylist — PATH layer (C0 gates 5 + 6).
 *
 * While a super_admin acts AS another user ("Bekijk als"), most writes are
 * allowed + audited — but GENUINELY DESTRUCTIVE / irreversible / sensitive-export
 * operations stay blocked. This module is the FIRST layer (enforced in
 * middleware by path + method). The SECOND layer is
 * `assertImpersonationAllowed()` in src/lib/domain/impersonation.ts, which
 * catches the path-SHARED destructive actions middleware cannot split (e.g.
 * disablePortalUser and shift-cancel both POST to a page path that also serves
 * harmless edits).
 *
 * Scope note: middleware's `config.matcher` covers /admin, /chef, /client only
 * (NOT /api/*). Server actions POST to their page path (covered here); the few
 * destructive route handlers also live under these prefixes. Pure module (no
 * next/headers, no db) so it is safe to import from edge middleware.
 *
 * Every entry below is mapped to a VERIFIED real route file (C0 gate 6), not a
 * guessed nav URL.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Prefixes whose MUTATING requests are destructive during impersonation.
 * GET/view stays allowed so "Bekijk als" can still SEE these screens — except
 * the explicit export/download endpoints below, blocked for ALL methods.
 */
const DESTRUCTIVE_WRITE_PREFIXES = [
  // AVG erasure/export/rectification, users, roles, webhook secrets, retention.
  // Also super_admin-only (the role gate already redirects an impersonated
  // non-super_admin away) — listed here as explicit belt-and-suspenders.
  // → src/app/(admin)/admin/system/**
  "/admin/system",
  // Payroll batch create + mark-exported (financial mutations).
  // → src/app/(admin)/admin/business/payroll/page.tsx
  "/admin/business/payroll",
  // Integration token / webhook-secret / outbox changes.
  // → src/app/(admin)/admin/business/integrations/{page,outbox}
  "/admin/business/integrations",
  // Future billing / invoicing surfaces — denied preemptively (no route yet).
  "/admin/business/billing",
  "/admin/business/invoices",
  // AVG self-service privacy flows (consent withdrawal, data requests).
  // → src/app/(chef)/chef/privacy/page.tsx, src/app/(client)/client/privacy/page.tsx
  "/chef/privacy",
  "/client/privacy",
];

/**
 * Endpoints blocked for ALL methods — they EXPORT / serve PII or financial
 * files (usually via GET), so the mutating-method test would miss them.
 */
const EXPORT_DOWNLOAD_MATCHERS: RegExp[] = [
  // → src/app/(admin)/admin/business/payroll/[id]/export.csv/route.ts
  /\/payroll\/[^/]+\/export\.csv$/,
  // → src/app/(admin)/admin/system/privacy-requests/[id]/download/route.ts
  /\/privacy-requests\/[^/]+\/download$/,
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * True when the given request must be BLOCKED while impersonating. Pairs with
 * the action-level `assertImpersonationAllowed()` guard. Safe (non-destructive)
 * writes — chef/client profile edits, comments, ratings, availability, hours,
 * normal shift status changes — return false (allowed + audited as the actor).
 */
export function isImpersonationDeniedPath(path: string, method: string): boolean {
  // (a) Sensitive export/download endpoints — block regardless of method.
  if (EXPORT_DOWNLOAD_MATCHERS.some((re) => re.test(path))) return true;

  // (b) Destructive writes on denylisted sections.
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    if (DESTRUCTIVE_WRITE_PREFIXES.some((p) => matchesPrefix(path, p))) {
      return true;
    }
  }

  return false;
}

/** Exported for tests + docs. */
export const IMPERSONATION_DENYLIST = {
  destructiveWritePrefixes: DESTRUCTIVE_WRITE_PREFIXES,
  exportDownloadMatchers: EXPORT_DOWNLOAD_MATCHERS,
} as const;
