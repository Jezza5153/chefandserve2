/**
 * Smoke — chef shift-relative reminders (CHEF-PR4). Pure logic, no DB.
 * Mirrors the route's tier selection + per-tier dedup: only the MOST-URGENT due
 * tier fires, each tier once, no stale 24h after a late confirm.
 * Run: node scripts/smoke-chef-shift-reminders.mjs
 */
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const TIERS = [{key:"24h",hours:24},{key:"2h",hours:2},{key:"start",hours:0.25}];
function dueTier(hoursUntil) {
  let idx = -1;
  for (let i=0;i<TIERS.length;i++) if (hoursUntil <= TIERS[i].hours) idx = i;
  return idx === -1 ? null : TIERS[idx].key;
}
// "send" = due tier exists AND not already sent
function send(hoursUntil, sent) { const t = dueTier(hoursUntil); return t && !sent.has(t) ? t : null; }

ok("25h out → no tier due", dueTier(25) === null);
ok("24h out → 24h tier", dueTier(24) === "24h");
ok("5h out → still 24h tier", dueTier(5) === "24h");
ok("2h out → 2h tier", dueTier(2) === "2h");
ok("1h out → 2h tier", dueTier(1) === "2h");
ok("15min out → start tier", dueTier(0.25) === "start");
ok("5min out → start tier", dueTier(5/60) === "start");

// normal lifecycle: each tier fires once
const sent = new Set();
let t;
t = send(24, sent); ok("fires 24h first", t === "24h"); sent.add(t);
t = send(5, sent); ok("24h already sent → silent at 5h", t === null);
t = send(2, sent); ok("fires 2h", t === "2h"); sent.add(t);
t = send(0.25, sent); ok("fires start", t === "start"); sent.add(t);
t = send(0.1, sent); ok("start already sent → silent", t === null);

// late confirm at 1h before → 2h tier fires, NEVER the stale 24h
const late = new Set();
t = send(1, late); ok("late-confirm @1h → 2h (not 24h)", t === "2h"); late.add(t);
ok("late-confirm never sends 24h", !late.has("24h"));

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
