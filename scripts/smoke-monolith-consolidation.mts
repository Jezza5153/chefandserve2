/**
 * Phase-4 monolith-consolidation smoke — proves the StatusBadge + fieldClass
 * adoption in the three admin business detail pages is a provably ZERO-pixel
 * refactor, WITHOUT a browser/auth harness (deterministic, fast).
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/smoke-monolith-consolidation.mts
 *
 * BASE = the branch fork point. Originals are pulled verbatim from git so the
 * proof is anchored to the pre-refactor source, not a hand-typed copy.
 *
 * Proves:
 *  - FIELDS (string analysis): every inline field className we swapped to
 *    `{fieldClass}` / `` `${fieldClass} <extras>` `` expands to the SAME Tailwind
 *    token-SET (sorted, deduped) as the original literal at BASE. Token ORDER is
 *    irrelevant — CSS is order-independent for these disjoint utilities, so
 *    same-set == zero pixel change.
 *  - BADGES (render via react-dom/server, mirrors smoke-ux-primitives): for the
 *    status pills in these files, the shared <StatusBadge> output token-set is
 *    compared against each candidate original span. ADOPTED pills (if any) must
 *    match exactly; pills we deliberately LEFT UNCHANGED are asserted to be
 *    genuinely NON-reproducible by StatusBadge (shade / geometry / weight
 *    divergence) — so this also guards against a future "close-enough" wrong
 *    adoption. In this PR zero badges were adoptable, so the adopted list is
 *    empty and the rejection guards carry the proof.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const BASE = process.env.SMOKE_BASE ?? "origin/feat/ux-primitives";

const { StatusBadge } = await import("@/components/ui/StatusBadge");
const { fieldClass } = await import("@/components/forms/Fields");

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

const tokenSet = (s: string): string =>
  [...new Set(s.split(/\s+/).filter(Boolean))].sort().join(" ");
const classAttr = (html: string): string => html.match(/class="([^"]*)"/)?.[1] ?? "";

/** Read a file verbatim from the BASE ref (the pre-refactor original). */
function showAtBase(file: string): string {
  return execFileSync("git", ["show", `${BASE}:${file}`], { encoding: "utf8" });
}

const CHEFS = "src/app/(admin)/admin/business/chefs/[id]/page.tsx";
const SHIFTS = "src/app/(admin)/admin/business/shifts/[id]/page.tsx";
const CLIENTS = "src/app/(admin)/admin/business/clients/[id]/page.tsx";

const baseSrc: Record<string, string> = {
  [CHEFS]: showAtBase(CHEFS),
  [SHIFTS]: showAtBase(SHIFTS),
  [CLIENTS]: showAtBase(CLIENTS),
};

/**
 * Assert that `needle` (a verbatim className literal) really existed in the BASE
 * file — so our "original token-set" is anchored to real pre-refactor source.
 */
function assertOriginalPresent(file: string, label: string, needle: string) {
  assert(`[orig] ${label} literal present at BASE`, baseSrc[file].includes(needle), file);
}

/* ============================================================ *
 *  TASK B — fieldClass adoption (pure string analysis)
 * ============================================================ */
console.log("TASK B — fieldClass adoption (token-set == original literal)");

type FieldCase = {
  label: string;
  file: string;
  /** the exact original className literal at BASE (verbatim) */
  original: string;
  /** what we replaced it with, expressed as fieldClass + optional extras */
  extras: string;
};

const ADOPTED_FIELDS: FieldCase[] = [
  // chefs
  {
    label: "chefs · decisionNotes textarea",
    file: CHEFS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "placeholder-ink-500",
  },
  {
    label: "chefs · Field baseClass const",
    file: CHEFS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "placeholder-ink-500",
  },
  // shifts (3 notes textareas — identical literal — + replyComment)
  {
    label: "shifts · intern notes textarea",
    file: SHIFTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "",
  },
  {
    label: "shifts · chefVisibleNotes textarea",
    file: SHIFTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "",
  },
  {
    label: "shifts · clientVisibleNotes textarea",
    file: SHIFTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "",
  },
  {
    label: "shifts · replyComment textarea",
    file: SHIFTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "placeholder-ink-500",
  },
  // clients
  {
    label: "clients · clientType select",
    file: CLIENTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "",
  },
  {
    label: "clients · decisionNotes textarea",
    file: CLIENTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "placeholder-ink-500",
  },
  {
    label: "clients · Field baseClass const",
    file: CLIENTS,
    original:
      "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
    extras: "placeholder-ink-500",
  },
];

for (const f of ADOPTED_FIELDS) {
  // 1. the original literal genuinely existed at BASE
  assertOriginalPresent(f.file, f.label, f.original);
  // 2. expanded (fieldClass + extras) token-set == original token-set
  const expanded = `${fieldClass} ${f.extras}`.trim();
  const got = tokenSet(expanded);
  const want = tokenSet(f.original);
  assert(`${f.label} — token-set == original`, got === want, `\n      got =[${got}]\n      want=[${want}]`);
}

/* Fields we deliberately LEFT UNCHANGED (divergent geometry) — guard that they
 * are NOT equal to fieldClass, i.e. adopting them would have changed pixels. */
console.log("TASK B — divergent fields correctly left unchanged");
const DIVERGENT_FIELDS: { label: string; file: string; original: string }[] = [
  {
    label: "shifts · visibility select (px-2 py-1.5 text-xs, no w-full/ring)",
    file: SHIFTS,
    original:
      "rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-burgundy focus:outline-none",
  },
  {
    label: "shifts · logContact outcome select (px-2 py-1 text-[11px])",
    file: SHIFTS,
    original: "rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700",
  },
  {
    label: "shifts · logContact note input (w-28 px-2 py-1)",
    file: SHIFTS,
    original: "w-28 rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700",
  },
];
const FC_SET = tokenSet(fieldClass);
for (const d of DIVERGENT_FIELDS) {
  assertOriginalPresent(d.file, d.label, d.original);
  assert(`${d.label} — NOT == fieldClass (rightly untouched)`, tokenSet(d.original) !== FC_SET);
}

/* ============================================================ *
 *  TASK A — StatusBadge adoption (render via react-dom/server)
 * ============================================================ */
console.log("TASK A — StatusBadge adoption (rendered token-set == original span)");

const renderBadge = (props: Parameters<typeof StatusBadge>[0]): string =>
  tokenSet(classAttr(renderToStaticMarkup(React.createElement(StatusBadge, props))));

type BadgeCase = {
  label: string;
  file: string;
  original: string;
  props: Parameters<typeof StatusBadge>[0];
};

/* ADOPTED badges: rendered StatusBadge token-set must EQUAL the original span.
 * (Empty in this PR — every status pill in these files diverges from the shared
 * palette/geometry; see the rejection guards below.) */
const ADOPTED_BADGES: BadgeCase[] = [];
for (const b of ADOPTED_BADGES) {
  assertOriginalPresent(b.file, b.label, b.original);
  assert(`${b.label} — rendered == original`, renderBadge(b.props) === tokenSet(b.original));
}
if (ADOPTED_BADGES.length === 0) {
  console.log("  (0 badges adopted — none reproducible by StatusBadge; see guards)");
}

/* REJECTED pills: prove they are genuinely NON-reproducible by StatusBadge so
 * "leave unchanged" is correct. For each, render the closest StatusBadge attempt
 * (best tone + every size) and assert NONE equals the original token-set.
 * A future wrong adoption (e.g. mapping amber-700→StatusBadge amber) would flip
 * one of these to a match and fail the smoke. */
console.log("TASK A — status pills correctly left unchanged (non-reproducible)");

type RejectCase = {
  label: string;
  file: string;
  /** the effective rendered token-set of the original pill (what StatusBadge would have to match) */
  original: string;
  reason: string;
  /** tones to try for the closest-match attempt */
  tones: Parameters<typeof StatusBadge>[0]["tone"][];
  /** optional className extras the adopter might have appended */
  extras?: string[];
  /**
   * For function-component pills (header StatusBadge / PlacementStatusBadge) the
   * class is assembled at render time from a geometry template + a tone ternary
   * on separate source lines, so `original` never appears as one literal. List
   * the verbatim fragments instead — each must exist at BASE.
   */
  originalParts?: string[];
};

const REJECTED_BADGES: RejectCase[] = [
  {
    label: "chefs · header StatusBadge (onboarding→amber-700)",
    file: CHEFS,
    original:
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider bg-amber-100 text-amber-700",
    reason: "shade: amber-700 ≠ StatusBadge amber-800",
    tones: ["amber", "green", "blue", "gray", "red", "burgundy"],
    originalParts: [
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}",
      '"bg-amber-100 text-amber-700"',
    ],
  },
  {
    label: "chefs · 'Wacht op akkoord' pill",
    file: CHEFS,
    original:
      "rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800",
    reason: "geometry px-2 py-0.5 + no font-medium",
    tones: ["amber"],
  },
  {
    label: "chefs · portal 'Actief' pill (px-3 py-1 text-[9px])",
    file: CHEFS,
    original:
      "rounded-full bg-emerald-100 px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-emerald-700",
    reason: "geometry px-3 py-1 text-[9px] — no SIZE combo (sm=px-2.5, md=text-[10px])",
    tones: ["green"],
    extras: ["", "shrink-0"],
  },
  {
    label: "shifts · header StatusBadge (open→amber-700)",
    file: SHIFTS,
    original:
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider bg-amber-100 text-amber-700",
    reason: "shade: amber-700 ≠ amber-800",
    tones: ["amber", "green", "blue", "gray", "red"],
    originalParts: [
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}",
      '"bg-amber-100 text-amber-700"',
    ],
  },
  {
    label: "shifts · PlacementStatusBadge (proposed→amber-700)",
    file: SHIFTS,
    original:
      "rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider bg-amber-100 text-amber-700",
    reason: "shade: amber-700 ≠ amber-800 (sm geometry otherwise matches)",
    tones: ["amber", "green", "blue", "gray", "red"],
    originalParts: [
      "rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}",
      "status === \"proposed\"\n          ? \"bg-amber-100 text-amber-700\"",
    ],
  },
  {
    label: "shifts · favoriet pill (px-2 py-0.5)",
    file: SHIFTS,
    original:
      "rounded-full bg-emerald-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider text-emerald-700",
    reason: "geometry px-2 py-0.5 — no SIZE combo",
    tones: ["green"],
  },
  {
    label: "clients · header StatusBadge (prospect→amber-700)",
    file: CLIENTS,
    original:
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider bg-amber-100 text-amber-700",
    reason: "shade: amber-700 ≠ amber-800",
    tones: ["amber", "green", "blue", "gray"],
    originalParts: [
      "rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}",
      '"bg-amber-100 text-amber-700"',
    ],
  },
  {
    label: "clients · 'Wacht op akkoord' pill",
    file: CLIENTS,
    original:
      "rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800",
    reason: "geometry px-2 py-0.5 + no font-medium",
    tones: ["amber"],
  },
  {
    label: "clients · portal 'Actief' pill (px-3 py-1 text-[9px])",
    file: CLIENTS,
    original:
      "rounded-full bg-emerald-100 px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-emerald-700",
    reason: "geometry px-3 py-1 text-[9px] — no SIZE combo",
    tones: ["green"],
    extras: ["", "shrink-0"],
  },
];

const SIZES: Parameters<typeof StatusBadge>[0]["size"][] = ["sm", "md"];
for (const r of REJECTED_BADGES) {
  if (r.originalParts) {
    // Function-component pill: class assembled from geometry template + tone
    // ternary on separate lines — assert each fragment exists verbatim at BASE.
    for (const part of r.originalParts) {
      assert(`[orig] ${r.label} fragment present at BASE`, baseSrc[r.file].includes(part), part);
    }
  } else {
    assertOriginalPresent(r.file, r.label, r.original);
  }
  const want = tokenSet(r.original);
  let anyMatch = false;
  for (const tone of r.tones) {
    for (const size of SIZES) {
      for (const extra of r.extras ?? [""]) {
        const got = renderBadge({ tone, label: "X", size, className: extra });
        if (got === want) anyMatch = true;
      }
    }
  }
  assert(`${r.label} — NOT reproducible (${r.reason})`, !anyMatch);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} monolith-consolidation smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
