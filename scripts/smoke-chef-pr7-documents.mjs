/**
 * Smoke — chef PR-7 "Mijn documenten" area. Read-only + non-mutating.
 *
 * 1. The chef_documents columns the area reads exist (expires_at / verified_at /
 *    deleted_at / chef_id), so list + expiry surfacing + ownership delete work.
 * 2. The expiry-note thresholds (mirror the page) bucket correctly: >30d none,
 *    <=30d "binnenkort", <0 "verlopen".
 * 3. The upload-category → enum mapping only yields valid chef_document_type keys.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr7-documents.mjs
 * Plain JS so it runs under node directly (tsx is unreliable on Node 25 here).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!url) throw new Error("No DATABASE_URL — run via: node --env-file=.env.local scripts/...");
if (!/ep-green-mouse/.test(url)) {
  throw new Error(`Refusing: smoke runs against DEV (ep-green-mouse) only. Host looks like: ${(url.match(/@([^/]+)/) || [])[1]}`);
}
const sql = neon(url);
let failures = 0;
const ok = (label, pass) => {
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  if (!pass) failures++;
};

// 1 — columns present
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='chef_documents'
    AND column_name IN ('chef_id','expires_at','verified_at','deleted_at','r2_key')`;
ok(`chef_documents columns present (${cols.length}/5)`, cols.length === 5);

// 2 — expiry-note thresholds (mirror page expiryNote)
const note = (daysFromNow) => {
  if (daysFromNow == null) return null;
  if (daysFromNow < 0) return "verlopen";
  if (daysFromNow <= 30) return "binnenkort";
  return null;
};
ok("no expiry → no note", note(null) === null);
ok("90 days out → no note", note(90) === null);
ok("30 days out → binnenkort", note(30) === "binnenkort");
ok("1 day out → binnenkort", note(1) === "binnenkort");
ok("expired (-2) → verlopen", note(-2) === "verlopen");

// 3 — upload-category mapping yields only valid enum keys
const enumVals = await sql`
  SELECT e.enumlabel v FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE t.typname='chef_document_type'`;
const valid = new Set(enumVals.map((r) => r.v));
const ALLOWED = ["id_document", "certificate", "other"];
ok("all upload categories are valid enum keys", ALLOWED.every((k) => valid.has(k)));
const mapType = (t) => (ALLOWED.includes(t) ? t : "other");
ok("unknown category falls back to 'other'", mapType("loonstrook") === "other");
ok("known category passes through", mapType("id_document") === "id_document");

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
