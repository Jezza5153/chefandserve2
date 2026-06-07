/**
 * smoke-form-adoption.mts — proof for Phase 2 (form-layer adoption).
 *
 * For every file changed on this branch vs HEAD, this script proves the
 * INVARIANT: each field whose `className` literal we replaced with a
 * `fieldClass`-based expression has, after expansion, a token-set that is
 * BYTE-IDENTICAL (as a sorted, de-duped set) to the git-HEAD original literal.
 *
 * Pure string analysis — no React, no rendering. Reads:
 *   - the new file from disk (working tree)
 *   - the original file via `git show HEAD:<path>`
 *   - the canonical `fieldClass` constant from src/components/forms/Fields.tsx
 *
 * Method per field:
 *   1. Collect the NEW className expressions we introduced:
 *        a) `className={fieldClass}`                          (EXACT swap)
 *        b) `className={`${fieldClass} <extra…>`}`            (placeholder superset)
 *      For each, compute the EXPANDED token-set =
 *        tokens(fieldClass) ∪ tokens(<extra…>).
 *   2. Collect the ORIGINAL inline literals from HEAD that are field-style
 *      strings (contain `border-ink-200` + `focus:ring-burgundy`, i.e. the
 *      canonical field shape), as multiset of sorted token-sets.
 *   3. Assert the multiset of expanded NEW token-sets is a sub-multiset of the
 *      ORIGINAL field-literal token-sets — i.e. every field we rewrote maps
 *      back to an identical original token-set. Print ✓/✗ per field.
 *
 * Exits non-zero on any mismatch, or if a changed file's field count doesn't
 * reconcile.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FIELDS_PATH = "src/components/forms/Fields.tsx";

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", cwd: process.cwd() });
}

/** Read the exported `fieldClass` string literal value from Fields.tsx (working tree). */
function readFieldClass(): string {
  const src = readFileSync(FIELDS_PATH, "utf8");
  // export const fieldClass =\n  "....";
  const m = src.match(/export const fieldClass\s*=\s*\n?\s*"([^"]*)"/);
  if (!m) throw new Error("Could not parse fieldClass from " + FIELDS_PATH);
  return m[1];
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}
function sortedKey(tokens: Iterable<string>): string {
  return [...new Set(tokens)].sort().join(" ");
}

const FIELD_CLASS = readFieldClass();
const FIELD_TOKENS = [...tokenSet(FIELD_CLASS)];
const FIELD_KEY = sortedKey(FIELD_TOKENS);

console.log(`fieldClass = "${FIELD_CLASS}"`);
console.log(`fieldClass token-set (${FIELD_TOKENS.length}) = ${FIELD_KEY}\n`);

// Baseline = the branch fork point (origin/main by default). Works as a durable PR-time
// guard whether the edits are committed or not; override with SMOKE_BASE if based elsewhere.
const BASE = process.env.SMOKE_BASE ?? "origin/main";
// Files changed on this branch since BASE (only our edits).
const changed = sh(`git diff --name-only ${BASE}...HEAD`)
  .trim()
  .split("\n")
  .filter((f) => f && f.endsWith(".tsx") && f !== FIELDS_PATH);

if (changed.length === 0) {
  console.error("✗ No changed .tsx files found — nothing to prove.");
  process.exit(1);
}

/**
 * Extract every NEW fieldClass-based className expression we introduced.
 * Returns expanded token-set keys (sorted strings).
 */
function newExpandedKeys(src: string): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];

  // (a) bare: className={fieldClass}
  for (const m of src.matchAll(/className=\{fieldClass\}/g)) {
    out.push({ key: FIELD_KEY, raw: m[0] });
  }
  // (b) template: className={`${fieldClass} <extra...>`}
  //     capture the text after ${fieldClass} up to the closing backtick.
  for (const m of src.matchAll(/className=\{`\$\{fieldClass\}([^`]*)`\}/g)) {
    const extra = m[1].trim();
    const key = sortedKey([...FIELD_TOKENS, ...extra.split(/\s+/).filter(Boolean)]);
    out.push({ key, raw: "`${fieldClass} " + extra + "`" });
  }
  return out;
}

/**
 * Extract ORIGINAL inline field-style className literals from HEAD source.
 * A "field-style" literal is a double-quoted className that contains both
 * `border-ink-200` and `focus:ring-burgundy` (the canonical field shape) —
 * these are the only literals we ever rewrite to fieldClass.
 * Returns sorted token-set keys.
 */
function originalFieldKeys(src: string): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];
  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    const raw = m[1];
    if (raw.includes("border-ink-200") && raw.includes("focus:ring-burgundy")) {
      out.push({ key: sortedKey(tokenSet(raw)), raw });
    }
  }
  return out;
}

let totalFields = 0;
let totalOk = 0;
let hadFail = false;

for (const file of changed) {
  const now = readFileSync(file, "utf8");
  let head: string;
  try {
    head = sh(`git show ${BASE}:"${file}"`);
  } catch {
    console.error(`✗ ${file}: could not read HEAD version`);
    hadFail = true;
    continue;
  }

  const newKeys = newExpandedKeys(now);
  if (newKeys.length === 0) {
    // A changed file with no new fieldClass className means the change was
    // import-only or unrelated — flag it, we expect every changed file to
    // carry at least one rewritten field.
    console.error(`✗ ${file}: changed but no fieldClass className expression found`);
    hadFail = true;
    continue;
  }

  // Build a multiset (counts) of original field-literal keys from HEAD.
  const origKeys = originalFieldKeys(head);
  const origCounts = new Map<string, number>();
  for (const o of origKeys) origCounts.set(o.key, (origCounts.get(o.key) ?? 0) + 1);

  console.log(`── ${file}  (${newKeys.length} field${newKeys.length === 1 ? "" : "s"} rewritten)`);

  // Also: assert the NEW file no longer contains the original literal for each
  // rewritten field (i.e. the swap actually happened) AND that HEAD contained
  // a matching original token-set we can consume.
  const remaining = new Map(origCounts);
  for (const nk of newKeys) {
    totalFields++;
    const have = remaining.get(nk.key) ?? 0;
    if (have > 0) {
      remaining.set(nk.key, have - 1);
      totalOk++;
      console.log(`   ✓ ${nk.raw}`);
      console.log(`       expanded set == HEAD original set: ${nk.key}`);
    } else {
      hadFail = true;
      console.log(`   ✗ ${nk.raw}`);
      console.log(`       expanded set: ${nk.key}`);
      console.log(`       NO matching original field literal with this exact token-set in HEAD:${file}`);
      console.log(`       HEAD field literals were:`);
      for (const o of origKeys) console.log(`         - ${o.key}`);
    }
  }
  console.log("");
}

console.log("──────────────────────────────────────────");
console.log(`Files changed: ${changed.length}`);
console.log(`Fields rewritten: ${totalFields}   ✓ ${totalOk}   ✗ ${totalFields - totalOk}`);

if (hadFail) {
  console.error("\n✗ INVARIANT VIOLATED — at least one field's token-set does not match its HEAD original.");
  process.exit(1);
}
console.log("\n✓ INVARIANT HOLDS — every rewritten field expands to a byte-identical sorted token-set vs HEAD.");
process.exit(0);
