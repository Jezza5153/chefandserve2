/**
 * Smoke — chef in-shift signals (CHEF-PR3). Read-only + non-mutating.
 *
 * 1. Migration 0065 table + enum present (shift_signals, shift_signal_kind with
 *    the 5 expected values).
 * 2. The ownership gate (a chef may only signal on a placement they own that is
 *    accepted/confirmed) and the urgent/throttle classification (mirror
 *    shift-signals.ts) evaluate correctly. Pure logic — no real-table writes.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-in-shift-signals.mjs
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

// 1 — table + enum present
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='shift_signals'
    AND column_name IN ('id','placement_id','chef_id','shift_id','kind','detail','created_at')`;
ok(`shift_signals columns present (${cols.length}/7)`, cols.length === 7);

const kinds = await sql`
  SELECT e.enumlabel v FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE t.typname='shift_signal_kind' ORDER BY e.enumsortorder`;
ok("kind enum = onderweg/vertraagd/hulp/onveilig/kan_niet_starten",
  kinds.map((r) => r.v).join(",") === "onderweg,vertraagd,hulp,onveilig,kan_niet_starten");

// 2 — ownership gate (mirror recordShiftSignal): owned placement, accepted/confirmed.
const canSignal = (ownedByChef, status) =>
  ownedByChef && ["accepted", "confirmed"].includes(status);
ok("owned + confirmed → can signal", canSignal(true, "confirmed") === true);
ok("owned + accepted → can signal", canSignal(true, "accepted") === true);
ok("owned + proposed → cannot", canSignal(true, "proposed") === false);
ok("owned + completed → cannot", canSignal(true, "completed") === false);
ok("NOT owned → cannot (IDOR guard)", canSignal(false, "confirmed") === false);

// urgent classification + safety-always-notifies (mirror SHIFT_SIGNAL_UI + notify gate).
const URGENT = new Set(["kan_niet_starten", "hulp", "onveilig"]);
ok("onveilig is urgent", URGENT.has("onveilig"));
ok("hulp is urgent", URGENT.has("hulp"));
ok("onderweg is NOT urgent", !URGENT.has("onderweg"));
// notify gate: onveilig bypasses the throttle; others throttle when a recent same-kind exists.
const shouldNotify = (kind, sameKindRecently) => kind === "onveilig" || !sameKindRecently;
ok("onveilig notifies even if recent (safety bypass)", shouldNotify("onveilig", true) === true);
ok("onderweg throttled if recent same-kind", shouldNotify("onderweg", true) === false);
ok("onderweg notifies if none recent", shouldNotify("onderweg", false) === true);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
