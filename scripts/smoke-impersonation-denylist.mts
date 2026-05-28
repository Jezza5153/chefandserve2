/**
 * Impersonation denylist smoke — path/method blocking rules (pure, no DB).
 *   npx tsx scripts/smoke-impersonation-denylist.mts
 *
 * Verifies the C0 denylist against REAL routes: destructive writes + sensitive
 * exports are blocked; normal "fix a setting" writes + plain views pass.
 */

const m = await import("@/lib/impersonation-denylist");
const denied = m.isImpersonationDeniedPath;

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

console.log("=== impersonation denylist smoke ===\n");

console.log("── DENIED: destructive writes ──");
assert("payroll batch create (POST page)", denied("/admin/business/payroll", "POST"));
assert("payroll mark-exported (POST page)", denied("/admin/business/payroll", "post"));
assert("payroll CSV export (GET route)", denied("/admin/business/payroll/abc123/export.csv", "GET"));
assert("integrations token change (POST)", denied("/admin/business/integrations", "POST"));
assert("integrations outbox retry (POST)", denied("/admin/business/integrations/outbox", "POST"));
assert("AVG erasure/decide (POST system)", denied("/admin/system/privacy-requests/req-1", "POST"));
assert("AVG export download (GET route)", denied("/admin/system/privacy-requests/req-1/download", "GET"));
assert("invite internal staff (POST)", denied("/admin/system/users/new", "POST"));
assert("roles change (POST)", denied("/admin/system/roles", "POST"));
assert("webhook secret (POST)", denied("/admin/system/webhooks/wh-1", "POST"));
assert("retention policy (POST)", denied("/admin/system/retention", "POST"));
assert("chef AVG self-service (POST)", denied("/chef/privacy", "POST"));
assert("client AVG self-service (POST)", denied("/client/privacy", "POST"));
assert("future billing (POST)", denied("/admin/business/billing", "POST"));

console.log("\n── ALLOWED: normal 'fix a setting' writes + views ──");
assert("chef detail edit (POST page)", !denied("/admin/business/chefs/chef-1", "POST"));
assert("client detail edit (POST page)", !denied("/admin/business/clients/c-1", "POST"));
assert("shift detail action (POST page)", !denied("/admin/business/shifts/s-1", "POST"));
assert("chef portal profile (POST)", !denied("/chef/profile", "POST"));
assert("chef availability (POST)", !denied("/chef/availability", "POST"));
assert("client profile (POST)", !denied("/client/profile", "POST"));
assert("admin hours review (POST)", !denied("/admin/business/hours/h-1", "POST"));
assert("admin dashboard view (GET)", !denied("/admin/business", "GET"));
assert("payroll page VIEW (GET) stays visible", !denied("/admin/business/payroll", "GET"));
assert("roster view (GET)", !denied("/admin/business/roster", "GET"));

console.log("\n── method sensitivity ──");
assert("GET on payroll prefix not a write-block", !denied("/admin/business/payroll/x", "GET"));
assert("DELETE on integrations blocked", denied("/admin/business/integrations", "DELETE"));
assert("PATCH on system blocked", denied("/admin/system/users/u-1", "PATCH"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
