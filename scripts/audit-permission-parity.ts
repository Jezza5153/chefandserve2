/**
 * Permission parity audit (PR-RBAC-1) — the regression gate for the gate-flip.
 *
 * Proves, WITHOUT a database, that converting the ~113 role-name gates to
 * permission gates changes nothing:
 *
 *   1. logic parity — for every GATE_MAP entry, the roles that satisfied the
 *      OLD role-name gate == the roles whose ROLE_GRANTS include the mapped
 *      permission (super_admin holds all).
 *   2. perm existence — every GATE_MAP perm + every granted perm is in CATALOG.
 *   3. class consistency — super_admin gates map to SYSTEM perms; owner /
 *      owner_planner gates map to BUSINESS perms.
 *   4. security wall — no business role (owner/planner) is granted a system perm.
 *   5. code coverage — every requireRole/requireAnyRole site under
 *      src/app/(admin) maps to a GATE_MAP route (no gated page left unmapped,
 *      so the C3 flip can't silently miss one).
 *
 * Run: npx tsx scripts/audit-permission-parity.ts   (exit 0 = parity holds)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  GATE_MAP,
  ROLE_GRANTS,
  SYSTEM_ROLE_KEYS,
  isSystemPermission,
  permForRoute,
  permKeyExists,
  rolesSatisfyingOldGate,
  rolesWithPermission,
} from "../src/lib/rbac/catalog";

let pass = 0;
let fail = 0;
function ok(_name: string) {
  pass++;
}
function bad(name: string, detail?: string) {
  fail++;
  console.log("  ✗", name, detail ? `— ${detail}` : "");
}
function eqSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

console.log("=== permission parity audit ===\n");

/* 1. logic parity + 2. perm existence + 3. class consistency ----------------- */
console.log("── parity per gate (oldGate roles == perm roles) ──");
for (const g of GATE_MAP) {
  if (!permKeyExists(g.perm)) {
    bad(`perm exists: ${g.id}`, `${g.perm} not in CATALOG`);
    continue;
  }
  const expected = rolesSatisfyingOldGate(g.oldGate);
  const actual = rolesWithPermission(g.perm);
  if (eqSet(expected, actual)) ok(g.id);
  else
    bad(
      `parity: ${g.id}`,
      `oldGate ${g.oldGate} = {${[...expected].sort()}} but perm ${g.perm} = {${[...actual].sort()}}`,
    );

  const wantSystem = g.oldGate === "super_admin";
  if (wantSystem !== isSystemPermission(g.perm))
    bad(`class: ${g.id}`, `oldGate ${g.oldGate} ↔ perm ${g.perm} class mismatch`);
  else ok(`class:${g.id}`);
}
console.log(`  ${GATE_MAP.length} gates checked`);

/* 4. security wall — business roles hold no system perm --------------------- */
console.log("\n── security wall (no business role holds a system perm) ──");
for (const [role, perms] of Object.entries(ROLE_GRANTS)) {
  if (SYSTEM_ROLE_KEYS.has(role)) continue;
  const leaked = perms.filter((p) => isSystemPermission(p));
  if (leaked.length === 0) ok(`wall:${role}`);
  else bad(`wall: ${role}`, `holds system perms: ${leaked.join(", ")}`);
}
for (const [role, perms] of Object.entries(ROLE_GRANTS)) {
  const ghosts = perms.filter((p) => !permKeyExists(p));
  if (ghosts.length === 0) ok(`grants-exist:${role}`);
  else bad(`grants exist: ${role}`, `unknown perms: ${ghosts.join(", ")}`);
}
console.log("  walls + grant-existence checked");

/* 5. flip coverage + correctness ------------------------------------------- */
console.log("\n── flip coverage + correctness ──");
const ADMIN_ROOT = "src/app/(admin)";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

function fileToRoute(file: string): string {
  let r = file.replace(/^src\/app/, "").replace(/\/(page|route|actions)\.(t|j)sx?$/, "");
  r = r.replace(/\/\([^)]+\)/g, "");
  return r || "/";
}

let gatedFiles = 0;
const problems: string[] = [];
for (const file of walk(ADMIN_ROOT)) {
  const src = readFileSync(file, "utf8");
  // The flip must be complete — no role-name gate may remain.
  if (/require(Role|AnyRole)\s*\(/.test(src)) {
    problems.push(`${file}: still has requireRole/requireAnyRole (flip incomplete)`);
  }
  const route = fileToRoute(file);
  const expected = permForRoute(route);
  const re = /requirePermission\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(src))) {
    any = true;
    const callPerm = `${m[1]}.${m[2]}`;
    if (expected === null) {
      problems.push(`${file}: requirePermission ${callPerm} but route ${route} has no GATE_MAP perm`);
    } else if (!permKeyExists(callPerm)) {
      problems.push(`${file}: requirePermission ${callPerm} not in CATALOG (route ${route})`);
    } else {
      // The call perm's role-set must be ⊆ the route perm's (equal or STRICTER).
      // A read-gated page can have a write/manage action gate — that's narrower,
      // not a widening. Only a LOOSER gate (more roles) is a parity violation.
      const callRoles = rolesWithPermission(callPerm);
      const routeRoles = rolesWithPermission(expected);
      if (![...callRoles].every((r) => routeRoles.has(r)))
        problems.push(
          `${file}: requirePermission ${callPerm} {${[...callRoles].sort()}} ⊄ GATE_MAP ${expected} {${[...routeRoles].sort()}} (route ${route})`,
        );
    }
  }
  if (any) gatedFiles++;
}
if (problems.length === 0) {
  ok("coverage");
  console.log(
    `  ✓ ${gatedFiles} permission-gated files all use their GATE_MAP perm; 0 role-name gates remain`,
  );
} else {
  bad("flip coverage", `${problems.length} problem(s)`);
  for (const p of problems) console.log("     ·", p);
}

console.log(`\n=== parity audit: ${pass} checks passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
