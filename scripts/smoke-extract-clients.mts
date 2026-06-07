/**
 * Verbatim-relocation smoke for the clients/[id] detail-page refactor.
 *
 *   npx tsx scripts/smoke-extract-clients.mts
 *
 * Proves the extraction into co-located _components/ is a FAITHFUL relocation —
 * the JSX moved into each component is CHARACTER-IDENTICAL (after whitespace
 * normalization) to the pre-refactor source, so it is provably a zero-rewrite
 * move (not a re-typed approximation).
 *
 * BASELINE = the pre-refactor file pulled verbatim from git:
 *   git show origin/feat/monolith-consolidation:".../clients/[id]/page.tsx"
 *
 * (a) For EACH new _components/*.tsx: extract every JSX `return ( … )` block it
 *     returns (the exported section component + any co-located helper), normalize
 *     whitespace (collapse runs → single space, trim) and assert it is a SUBSTRING
 *     of the normalized baseline. ✓/✗ per block; exit(1) on any ✗.
 * (b) Assert the NEW page.tsx no longer contains each relocated block (so the
 *     markup genuinely MOVED, it was not duplicated).
 *
 * The page HEADER is deliberately excluded from (a): adopting DetailShell changes
 * the header chrome (the ONE allowed visual delta) — that is proven separately by
 * scripts/header-delta-clients.mts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.SMOKE_BASE ?? "origin/feat/monolith-consolidation";
const PAGE = "src/app/(admin)/admin/business/clients/[id]/page.tsx";
const COMPONENTS_DIR = "src/app/(admin)/admin/business/clients/[id]/_components";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `\n      — ${detail}` : "");
    fail++;
  }
}

/** Collapse all whitespace runs to a single space and trim (the normalization the proof is defined over). */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Verbatim baseline (pre-refactor) page source from git. */
const baseline = execFileSync("git", ["show", `${BASE}:${PAGE}`], { encoding: "utf8" });
const baselineNorm = norm(baseline);

/** Current (post-refactor) page source from disk. */
const pageNow = readFileSync(PAGE, "utf8");
const pageNowNorm = norm(pageNow);

/**
 * Extract every top-level `return ( … )` JSX block from a component source.
 * We scan for the token `return (`, then walk parens from the opening `(` to its
 * balanced close — robust to nested JSX/parens. Non-JSX returns (`return "…";`,
 * `return JSON.stringify(…)`) don't start with `return (` and are skipped.
 */
function extractReturnedJsx(src: string): string[] {
  const blocks: string[] = [];
  const re = /return\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // index of the opening paren
    let i = src.indexOf("(", m.index);
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    // inner content between the outer parens
    blocks.push(src.slice(i + 1, j));
    re.lastIndex = j + 1;
  }
  return blocks;
}

/**
 * Each extracted component. `label` is human-readable; `file` is read from disk;
 * we verify every JSX return block it contains is a verbatim substring of the
 * baseline, and (b) that the FIRST (main) block no longer lives in page.tsx.
 */
const COMPONENTS: { label: string; file: string }[] = [
  { label: "Klant360 (+ co-located KSnap)", file: `${COMPONENTS_DIR}/Klant360.tsx` },
  { label: "Binnenkort", file: `${COMPONENTS_DIR}/Binnenkort.tsx` },
  { label: "BasicsForm (+ co-located Field)", file: `${COMPONENTS_DIR}/BasicsForm.tsx` },
  { label: "ClientTypeSection (+ co-located ClientChefList)", file: `${COMPONENTS_DIR}/ClientTypeSection.tsx` },
  { label: "PortalAccessSection", file: `${COMPONENTS_DIR}/PortalAccessSection.tsx` },
  { label: "ChangeRequestsSection", file: `${COMPONENTS_DIR}/ChangeRequestsSection.tsx` },
];

console.log(`BASELINE = ${BASE}:${PAGE}`);
console.log("\n(a) VERBATIM substring proof — each moved JSX block ⊆ normalized baseline");
for (const c of COMPONENTS) {
  const src = readFileSync(c.file, "utf8");
  const blocks = extractReturnedJsx(src);
  assert(`${c.label}: found ≥1 JSX return block`, blocks.length >= 1, `found ${blocks.length}`);
  blocks.forEach((block, idx) => {
    const n = norm(block);
    const ok = baselineNorm.includes(n);
    const tag = blocks.length > 1 ? ` [block ${idx + 1}/${blocks.length}]` : "";
    assert(
      `${c.label}${tag}: JSX is a verbatim substring of baseline`,
      ok,
      ok ? undefined : `first 160 chars of unmatched block:\n        ${n.slice(0, 160)}…`,
    );
  });
}

console.log("\n(b) RELOCATION proof — moved blocks no longer present in new page.tsx");
for (const c of COMPONENTS) {
  const src = readFileSync(c.file, "utf8");
  const blocks = extractReturnedJsx(src);
  // Use the main (first/largest) returned block as the relocation fingerprint.
  const main = blocks.reduce((a, b) => (b.length > a.length ? b : a), blocks[0] ?? "");
  const n = norm(main);
  assert(
    `${c.label}: main block absent from new page.tsx`,
    n.length > 0 && !pageNowNorm.includes(n),
    pageNowNorm.includes(n) ? "block still present in page.tsx — not relocated" : undefined,
  );
}

console.log(`\n${fail === 0 ? "✅" : "❌"} extract-clients smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
