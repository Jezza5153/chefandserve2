/**
 * READ-ONLY audit — scans chef_submissions.rawPayload for special-category PII
 * (BSN), financial data (IBAN) and ID-document fields that may sit unencrypted in
 * the raw Jotform blob (AVG/GDPR liability — see docs/privacy/pii-inventory.md).
 *
 *   npx tsx scripts/audit-rawpayload-pii.mts
 *
 * Reports affected submission ids + the matched KEY NAMES + match kind. It NEVER
 * prints raw values. Does NOT write anything (pure SELECT). Safe to run anytime.
 *
 * Remediation is a separate, double-gated script: scripts/redact-rawpayload-pii.mts.
 */

import { config } from "dotenv";

import type { PiiKind } from "@/lib/domain/rawpayload-pii";

config({ path: ".env.local" });

const { scanForPii, matchedKeyNames } = await import("@/lib/domain/rawpayload-pii");
const { neon } = await import("@neondatabase/serverless");
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set.");
  process.exit(1);
}
const sql = neon(url);

type Row = { id: string; source: string; created_at: string; raw_payload: unknown };

const rows = (await sql`
  SELECT id, source, created_at, raw_payload FROM chef_submissions ORDER BY created_at
`) as Row[];

let affected = 0;
const byKind: Record<PiiKind, number> = { bsn: 0, iban: 0, id: 0 };

for (const r of rows) {
  const payload = typeof r.raw_payload === "string" ? JSON.parse(r.raw_payload) : r.raw_payload;
  const matches = scanForPii(payload);
  if (matches.length === 0) continue;
  affected++;
  for (const m of matches) byKind[m.kind]++;
  const kinds = [...new Set(matches.map((m) => m.kind))].join(", ");
  const keys = matchedKeyNames(matches).join(", "); // KEY NAMES ONLY — never values
  console.log(`  • ${r.id}  (source=${r.source}, ${String(r.created_at).slice(0, 10)})`);
  console.log(`      kinds: ${kinds}`);
  console.log(`      keys:  ${keys}`);
}

console.log("\n─────────────────────────────");
console.log(`Scanned ${rows.length} chef_submissions · ${affected} contain likely PII in raw_payload.`);
console.log(`Field matches by kind — BSN: ${byKind.bsn} · IBAN: ${byKind.iban} · ID: ${byKind.id}`);
console.log(
  affected > 0
    ? "\n⚠ Remediate with: RAWPAYLOAD_REDACT_ENABLED=true npx tsx scripts/redact-rawpayload-pii.mts  (dry-run first)"
    : "\n✓ No raw_payload PII detected.",
);
process.exit(0);
