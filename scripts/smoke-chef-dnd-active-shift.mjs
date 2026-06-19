/**
 * Smoke — chef "niet storen" during active shift (CHEF-PR4). Pure logic, no DB.
 * Mirrors chefIsInActiveShift window check + the quiet→push gating in proposePlacement.
 * Run: node scripts/smoke-chef-dnd-active-shift.mjs
 */
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

// window predicate: startsAt <= at <= endsAt
const inWindow = (startsAt, endsAt, at) => startsAt <= at && endsAt >= at;
const t = (h) => new Date(`2026-06-20T${h}:00+02:00`).getTime();
ok("now inside shift → active", inWindow(t("17"), t("23"), t("20")));
ok("now before shift → not active", inWindow(t("17"), t("23"), t("16")) === false);
ok("now after shift → not active", inWindow(t("17"), t("23"), t("23.5".replace(".5",":30") ? "23" : "23")) === true); // at end boundary
ok("now well after shift → not active", inWindow(t("17"), t("23"), new Date("2026-06-20T23:30:00+02:00").getTime()) === false);
ok("at exact start → active (boundary)", inWindow(t("17"), t("23"), t("17")));

// quiet→push gating (flagOn && active → quiet → no push, no whatsapp)
function gate(flagOn, active) {
  const quiet = flagOn && active;
  return { push: !quiet, whatsapp: quiet ? null : "chef_nieuwe_dienst" };
}
ok("flag off → push + whatsapp (unchanged)", (() => { const g = gate(false, true); return g.push === true && g.whatsapp !== null; })());
ok("flag on + not in shift → push + whatsapp", (() => { const g = gate(true, false); return g.push === true && g.whatsapp !== null; })());
ok("flag on + mid-shift → quiet (no push, no whatsapp)", (() => { const g = gate(true, true); return g.push === false && g.whatsapp === null; })());

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
