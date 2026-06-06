/**
 * RBAC C3 codemod — flip the role-name gates to permission gates.
 *
 * For every file under src/app/(admin) that calls requireRole/requireAnyRole,
 * resolve its route → the GATE_MAP permission (longest-prefix match), replace
 * each gate call with requirePermission("resource","action"[, nextPath]), and
 * rewrite the "@/lib/permissions" import. Behavior-neutral by construction —
 * proven afterwards by scripts/audit-permission-parity.ts + type-check + build.
 *
 *   npx tsx scripts/rbac-flip-gates.ts          # dry-run (report only)
 *   npx tsx scripts/rbac-flip-gates.ts --write  # apply
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GATE_MAP } from "../src/lib/rbac/catalog";

const WRITE = process.argv.includes("--write");
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

/** longest-prefix GATE_MAP match: the most specific route that is a prefix of R. */
function resolvePerm(route: string): string | null {
  let best: { g: string; perm: string } | null = null;
  for (const entry of GATE_MAP) {
    for (const g of entry.routes) {
      if (route === g || route.startsWith(g + "/")) {
        if (!best || g.length > best.g.length) best = { g, perm: entry.perm };
      }
    }
  }
  return best?.perm ?? null;
}

/** Build the requirePermission(...) replacement, preserving a string nextPath. */
function buildReplacement(perm: string, secondArg: string | undefined): string {
  const [resource, action] = perm.split(".");
  const nextPath =
    secondArg && secondArg.trim() !== "undefined" && /^["'].*["']$/.test(secondArg.trim())
      ? `, ${secondArg.trim()}`
      : "";
  return `requirePermission("${resource}", "${action}"${nextPath})`;
}

// match requireRole("x"[, nextPath][, {opts}]) and requireAnyRole([..][, nextPath][, {opts}])
const ROLE_RE = /requireRole\(\s*"[^"]+"\s*(?:,\s*([^,){]+?)\s*)?(?:,\s*\{[^}]*\}\s*)?\)/g;
const ANYROLE_RE = /requireAnyRole\(\s*\[[^\]]*\]\s*(?:,\s*([^,){]+?)\s*)?(?:,\s*\{[^}]*\}\s*)?\)/g;

let filesChanged = 0;
let callsChanged = 0;
const skipped: string[] = [];

for (const file of walk(ADMIN_ROOT)) {
  let src = readFileSync(file, "utf8");
  if (!/require(Role|AnyRole)\s*\(/.test(src)) continue;

  const perm = resolvePerm(fileToRoute(file));
  if (!perm) {
    skipped.push(`${file} (no GATE_MAP perm for route ${fileToRoute(file)})`);
    continue;
  }

  let n = 0;
  src = src.replace(ROLE_RE, (_m, second) => {
    n++;
    return buildReplacement(perm, second);
  });
  src = src.replace(ANYROLE_RE, (_m, second) => {
    n++;
    return buildReplacement(perm, second);
  });
  if (n === 0) continue;

  // rewrite the @/lib/permissions import: drop requireRole/requireAnyRole,
  // add requirePermission (dedup), keep the rest.
  src = src.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/permissions["'];/,
    (full, inner: string) => {
      const names = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => s !== "requireRole" && s !== "requireAnyRole");
      if (!names.includes("requirePermission")) names.push("requirePermission");
      // keep deterministic order
      names.sort();
      return `import { ${names.join(", ")} } from "@/lib/permissions";`;
    },
  );

  filesChanged++;
  callsChanged += n;
  console.log(`  ${WRITE ? "✎" : "·"} ${file}  →  ${perm}  (${n} call${n > 1 ? "s" : ""})`);
  if (WRITE) writeFileSync(file, src);
}

console.log(`\n${WRITE ? "APPLIED" : "DRY-RUN"}: ${callsChanged} calls in ${filesChanged} files`);
if (skipped.length) {
  console.log(`\n⚠ skipped (no mapping — investigate):`);
  for (const s of skipped) console.log("   ·", s);
}
if (!WRITE) console.log("\nRe-run with --write to apply.");
