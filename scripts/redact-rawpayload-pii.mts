/**
 * GUARDED one-time remediation — nulls out the specific rawPayload fields that the
 * audit (scripts/audit-rawpayload-pii.mts) flags as BSN / IBAN / ID-document PII in
 * chef_submissions, and writes an audit_log row per affected submission.
 *
 * Same double-gate discipline as workers/retention.ts (both default SAFE):
 *   RAWPAYLOAD_REDACT_ENABLED !== "true"      → log "disabled", exit (does nothing)
 *   else RAWPAYLOAD_REDACT_DRY_RUN !== "false" → DRY-RUN: report what WOULD change, write nothing
 *   else                                       → LIVE: null the matched fields + audit
 *
 *   # report only (default — even with ENABLED set):
 *   RAWPAYLOAD_REDACT_ENABLED=true npx tsx scripts/redact-rawpayload-pii.mts
 *   # actually redact:
 *   RAWPAYLOAD_REDACT_ENABLED=true RAWPAYLOAD_REDACT_DRY_RUN=false npx tsx scripts/redact-rawpayload-pii.mts
 *
 * Only the matched leaf fields are nulled; the rest of the payload is preserved.
 * Matched VALUES are never printed. The audit_log `after` records the redacted KEY
 * NAMES + kinds only (this is the same audit_log table src/lib/audit.ts writes to;
 * those helpers are request-scoped, so a standalone script inserts directly — the
 * worker convention, cf. workers/_lib.ts `audit()`).
 */

import { config } from "dotenv";

import type { PiiKind } from "@/lib/domain/rawpayload-pii";

config({ path: ".env.local" });

const ENABLED = process.env.RAWPAYLOAD_REDACT_ENABLED === "true";
const DRY_RUN = process.env.RAWPAYLOAD_REDACT_DRY_RUN !== "false"; // default true (safe)

const { scanForPii, matchedPaths, matchedKeyNames, redactPaths } = await import(
  "@/lib/domain/rawpayload-pii"
);
const { neon } = await import("@neondatabase/serverless");
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set.");
  process.exit(1);
}
const sql = neon(url);

function log(...a: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

// ----- gate 1: enabled -----
if (!ENABLED) {
  log("redact-rawpayload-pii: RAWPAYLOAD_REDACT_ENABLED != 'true' → disabled, exiting (no changes).");
  process.exit(0);
}
log(`redact-rawpayload-pii: ENABLED — mode=${DRY_RUN ? "DRY-RUN (report only)" : "LIVE (will null fields)"}`);

type Row = { id: string; raw_payload: unknown };
const rows = (await sql`SELECT id, raw_payload FROM chef_submissions ORDER BY created_at`) as Row[];

let affected = 0;
let redacted = 0;
const byKind: Record<PiiKind, number> = { bsn: 0, iban: 0, id: 0 };

for (const r of rows) {
  const payload = typeof r.raw_payload === "string" ? JSON.parse(r.raw_payload) : r.raw_payload;
  const matches = scanForPii(payload);
  if (matches.length === 0) continue;
  affected++;
  for (const m of matches) byKind[m.kind]++;

  const paths = matchedPaths(matches);
  const keyNames = matchedKeyNames(matches); // never values
  const kinds = [...new Set(matches.map((m) => m.kind))];
  log(`  • ${r.id}: ${DRY_RUN ? "would null" : "nulling"} keys [${keyNames.join(", ")}] (${kinds.join(", ")})`);

  if (DRY_RUN) continue;

  const cleaned = redactPaths(payload, paths);
  await sql`
    UPDATE chef_submissions
    SET raw_payload = ${JSON.stringify(cleaned)}::jsonb, updated_at = now()
    WHERE id = ${r.id}
  `;
  await sql`
    INSERT INTO audit_log (action, resource, resource_id, after, created_at)
    VALUES (
      'privacy.rawpayload_redacted',
      'chef_submissions',
      ${r.id},
      ${JSON.stringify({ redactedKeys: keyNames, kinds })}::jsonb,
      now()
    )
  `;
  redacted++;
}

log("─────────────────────────────");
log(`Scanned ${rows.length} · affected ${affected} · ${DRY_RUN ? "redacted 0 (dry-run)" : `redacted ${redacted}`}`);
log(`Field matches — BSN: ${byKind.bsn} · IBAN: ${byKind.iban} · ID: ${byKind.id}`);
if (DRY_RUN && affected > 0) {
  log("Re-run with RAWPAYLOAD_REDACT_DRY_RUN=false to apply.");
}
process.exit(0);
