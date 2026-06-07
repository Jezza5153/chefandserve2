/**
 * Faithful-refactor smoke for the chefs/[id] detail-page extraction.
 *
 *   npx tsx scripts/smoke-extract-chefs.mts
 *
 * BASELINE = the pre-refactor page at the branch fork point:
 *   git show origin/feat/monolith-consolidation:"src/app/(admin)/admin/business/chefs/[id]/page.tsx"
 *
 * Two proofs, both anchored to that verbatim baseline (no hand-typed copies):
 *
 *  (a) VERBATIM SUBSTRING — for EACH new _components/*.tsx, the JSX it relocated
 *      (delimited by `{/* @verbatim-start *​/}` … `{/* @verbatim-end *​/}`) is
 *      extracted, whitespace-normalized (every run of whitespace → one space,
 *      trimmed), and asserted to be a SUBSTRING of the identically-normalized
 *      baseline. This proves the moved markup is character-identical to the
 *      original (closure vars became same-named props, so the text is unchanged).
 *      Any DetailSection/section wrapper the component adds lives OUTSIDE the
 *      markers, so allowed chrome never pollutes the proof.
 *
 *  (b) RELOCATION — the NEW page.tsx no longer contains each relocated block
 *      (a representative verbatim line per component), confirming a real move
 *      rather than a copy.
 *
 * Prints ✓/✗ per check; process.exit(1) on any ✗.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const BASELINE_REF =
  process.env.SMOKE_BASE ?? "origin/feat/monolith-consolidation";
const PAGE_REL = "src/app/(admin)/admin/business/chefs/[id]/page.tsx";
const COMP_DIR = "src/app/(admin)/admin/business/chefs/[id]/_components";

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

/** Collapse every whitespace run to a single space and trim. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Read a file verbatim from the baseline ref (the pre-refactor original). */
function showAtBaseline(fileRel: string): string {
  return execFileSync("git", ["show", `${BASELINE_REF}:${fileRel}`], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function readLocal(fileRel: string): string {
  return readFileSync(join(ROOT, fileRel), "utf8");
}

/** Pull the text between the @verbatim-start / @verbatim-end markers. */
function verbatimRegion(src: string, file: string): string {
  const m = src.match(
    /@verbatim-start\s*\*\/\}?([\s\S]*?)\{?\/\*\s*@verbatim-end/,
  );
  if (!m) throw new Error(`no @verbatim markers found in ${file}`);
  return m[1];
}

console.log(`\nBaseline ref: ${BASELINE_REF}\n`);

const baselineRaw = showAtBaseline(PAGE_REL);
const baselineNorm = norm(baselineRaw);
const newPageRaw = readLocal(PAGE_REL);

// The components we extracted, with one representative line that MUST have moved
// out of page.tsx (relocation proof). The line is taken verbatim from baseline.
const COMPONENTS: { file: string; relocatedLine: string }[] = [
  {
    file: "RatingSummary.tsx",
    relocatedLine: `Klant-feedback (intern)`,
  },
  {
    file: "ChangeRequests.tsx",
    relocatedLine: `placeholder="Optionele toelichting (gedeeld met de chef)"`,
  },
  {
    file: "BasicsForm.tsx",
    relocatedLine: `Segmenten (waar werkt deze chef?)`,
  },
  {
    file: "PortalAccess.tsx",
    relocatedLine: `Geef deze chef toegang tot het portaal om zelf shifts te bekijken`,
  },
  {
    file: "DocumentsSection.tsx",
    relocatedLine: `in Cloudflare R2 — alleen toegankelijk via tijdelijk-getekende links.`,
  },
  {
    file: "Chef360.tsx",
    relocatedLine: `Chef 360 — staat van dienst`,
  },
];

// ---- (a) VERBATIM SUBSTRING proof -------------------------------------------
console.log("(a) Verbatim substring of baseline — per extracted component");
for (const { file } of COMPONENTS) {
  const rel = `${COMP_DIR}/${file}`;
  let region: string;
  try {
    region = verbatimRegion(readLocal(rel), file);
  } catch (e) {
    assert(`${file}: verbatim markers present`, false, (e as Error).message);
    continue;
  }
  const normRegion = norm(region);
  const isSub = baselineNorm.includes(normRegion);
  // On failure, surface the first ~120 chars that diverge to make debugging quick.
  let detail = "";
  if (!isSub) {
    const head = normRegion.slice(0, 160);
    detail = `relocated JSX is NOT a substring of baseline.\n        region head: ${head}…`;
  }
  assert(
    `${file}: relocated JSX (${normRegion.length} chars) ⊆ baseline`,
    isSub,
    detail,
  );
}

// ---- (b) RELOCATION proof ----------------------------------------------------
console.log("\n(b) Relocation — new page.tsx no longer contains the moved blocks");
for (const { file, relocatedLine } of COMPONENTS) {
  // The representative line must exist in the baseline (sanity on our anchor)…
  const inBaseline = baselineRaw.includes(relocatedLine);
  assert(`${file}: anchor line exists in baseline`, inBaseline, relocatedLine);
  // …and must be GONE from the new page.tsx (it now lives in the component).
  const goneFromPage = !newPageRaw.includes(relocatedLine);
  assert(
    `${file}: anchor line removed from page.tsx`,
    goneFromPage,
    goneFromPage ? "" : `still present: ${relocatedLine}`,
  );
}

console.log(`\n${fail === 0 ? "✓ PASS" : "✗ FAIL"} — ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
