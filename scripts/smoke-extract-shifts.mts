/**
 * VERBATIM-RELOCATION smoke for the shifts/[id] detail-page extraction.
 *
 *   npx tsx scripts/smoke-extract-shifts.mts
 *
 * BASELINE = the pre-refactor source, pulled verbatim from git (NOT a hand
 * copy) so the proof is anchored to the real fork point:
 *   git show origin/feat/monolith-consolidation:src/app/(admin)/admin/business/shifts/[id]/page.tsx
 *
 * Two proofs (both must pass; any ✗ → process.exit(1)):
 *
 *  (a) SUBSTRING — for EACH new _components/*.tsx, extract every JSX block it
 *      returns (`return ( … )`, balanced-paren scan), normalize whitespace
 *      (collapse all whitespace runs to a single space, trim), and assert the
 *      result is a SUBSTRING of the whitespace-normalized baseline. This is the
 *      hard guarantee that the moved markup is character-identical to the
 *      original (closure vars → same-name props, no reformatting/renaming).
 *
 *  (b) ABSENCE — assert the NEW page.tsx no longer contains each relocated
 *      block (one distinctive normalized signature per component), proving the
 *      render really moved out rather than being duplicated.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SMOKE_BASE ?? "origin/feat/monolith-consolidation";
const PAGE_REL = "src/app/(admin)/admin/business/shifts/[id]/page.tsx";
const COMPONENTS_DIR = "src/app/(admin)/admin/business/shifts/[id]/_components";

function showAtBase(file: string): string {
  return execFileSync("git", ["show", `${BASE}:${file}`], {
    encoding: "utf8",
    cwd: ROOT,
  });
}
function readNow(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** collapse every whitespace run to a single space, then trim */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract every JSX block returned by a component file: find each `return (`
 * and walk forward tracking paren depth (ignoring parens inside string / template
 * literals) until the matching `)`. Returns the inner text of each block.
 */
function extractReturnedJsx(src: string): string[] {
  const blocks: string[] = [];
  const re = /\breturn\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length; // first char after "return ("
    const start = i;
    let depth = 1;
    let inStr: string | null = null; // ' " or `
    while (i < src.length && depth > 0) {
      const ch = src[i];
      const prev = src[i - 1];
      if (inStr) {
        if (ch === inStr && prev !== "\\") inStr = null;
      } else if (ch === "'" || ch === '"' || ch === "`") {
        inStr = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    // i now points one past the closing ")"
    blocks.push(src.slice(start, i - 1));
  }
  return blocks;
}

const baselineNorm = norm(showAtBase(PAGE_REL));
const pageNowNorm = norm(readNow(PAGE_REL));

// new component files (relative path → friendly name)
const COMPONENTS: Array<{ name: string; rel: string }> = [
  { name: "SummaryCard", rel: `${COMPONENTS_DIR}/SummaryCard.tsx` },
  { name: "NotesForm", rel: `${COMPONENTS_DIR}/NotesForm.tsx` },
  { name: "ExistingPlacements", rel: `${COMPONENTS_DIR}/ExistingPlacements.tsx` },
  { name: "MatchSuggestions", rel: `${COMPONENTS_DIR}/MatchSuggestions.tsx` },
  { name: "EmptyState", rel: `${COMPONENTS_DIR}/EmptyState.tsx` },
];

// One distinctive marker per component for the ABSENCE proof (normalized).
const ABSENCE_MARKERS: Record<string, string> = {
  SummaryCard: norm(`<SummaryCell label="Aantal nodig"`),
  NotesForm: norm(`Notities opslaan`),
  ExistingPlacements: norm(`Voorgestelde chefs ({existingPlacements.length})`),
  MatchSuggestions: norm(`Vul deze dienst — beste matches (top {matches.length})`),
  EmptyState: norm(`Geen geschikte chefs gevonden`),
};

let fails = 0;
const tick = (ok: boolean) => (ok ? "✓" : "✗");

console.log(`\nVERBATIM smoke — baseline: ${BASE}:${PAGE_REL}\n`);
console.log(`(a) substring proof — moved JSX is character-identical to baseline:`);

for (const { name, rel } of COMPONENTS) {
  const src = readNow(rel);
  const blocks = extractReturnedJsx(src);
  if (blocks.length === 0) {
    console.log(`  ✗ ${name}: no \`return ( … )\` JSX block found in ${rel}`);
    fails++;
    continue;
  }
  let allOk = true;
  const misses: number[] = [];
  blocks.forEach((b, idx) => {
    const nb = norm(b);
    if (nb.length === 0) return; // skip empty
    if (!baselineNorm.includes(nb)) {
      allOk = false;
      misses.push(idx);
    }
  });
  console.log(
    `  ${tick(allOk)} ${name} — ${blocks.length} JSX block(s) ${
      allOk ? "all substrings of baseline" : `NOT a substring (block#: ${misses.join(", ")})`
    }`,
  );
  if (!allOk) {
    fails++;
    // show the first miss for debugging
    const first = norm(blocks[misses[0]]);
    console.log(`      first miss (normalized, 220 chars): ${first.slice(0, 220)}…`);
  }
}

console.log(`\n(b) absence proof — relocated blocks no longer live in page.tsx:`);
for (const { name } of COMPONENTS) {
  const marker = ABSENCE_MARKERS[name];
  const present = pageNowNorm.includes(marker);
  console.log(
    `  ${tick(!present)} ${name} — signature ${present ? "STILL PRESENT in page.tsx" : "absent from page.tsx"}`,
  );
  if (present) fails++;
}

// Sanity: the markers must actually exist in the baseline (guards against a
// typo'd marker silently "passing" the absence test).
console.log(`\n(b') marker sanity — each absence-marker exists in baseline:`);
for (const { name } of COMPONENTS) {
  const marker = ABSENCE_MARKERS[name];
  const inBaseline = baselineNorm.includes(marker);
  console.log(`  ${tick(inBaseline)} ${name} — marker present in baseline`);
  if (!inBaseline) fails++;
}

console.log(
  `\n${fails === 0 ? "✓ ALL VERBATIM CHECKS PASSED" : `✗ ${fails} CHECK(S) FAILED`}\n`,
);
process.exit(fails === 0 ? 0 : 1);
