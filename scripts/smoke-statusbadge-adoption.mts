/**
 * Phase-3 StatusBadge-adoption smoke — proves the 5 candidate status-pill call
 * sites were handled with ZERO pixel change, WITHOUT a browser/auth harness
 * (deterministic, fast). Mirrors scripts/smoke-ux-primitives.mts.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/smoke-statusbadge-adoption.mts
 *
 * Method (same as the Phase-0 smoke): render a component via react-dom/server,
 * extract its class attribute, and compare the Tailwind utility *SET* (order
 * is irrelevant — these are disjoint utilities, so same-set == same pixels).
 *
 * Two kinds of proof:
 *
 *  A. ADOPTED sites (privacy-requests StatusPill, client RequestStatusBadge):
 *     for every status value we render the NEW <StatusBadge .../> call (with that
 *     site's LOCAL tone+label map) and assert its class token-set EQUALS the
 *     git-HEAD original span's token-set for that status. The escaped Dutch label
 *     must also survive.
 *
 *  B. LEFT-UNCHANGED sites (inbox list, inbox detail, chef-profile pending pill):
 *     we PROVE the original could NOT be reproduced by ANY StatusBadge call
 *     without a conflicting-token append. StatusBadge always emits
 *       BASE ∪ SIZE[size] ∪ statusToneClass[tone]
 *     plus purely-additive className tokens. So the original is reproducible iff
 *     (BASE ∪ SIZE[size] ∪ TONE[tone]) ⊆ originalSet for some (size,tone) — a
 *     className can only ADD the leftover tokens, never remove/replace one. We
 *     assert NO such (size,tone) exists, and print the exact blocking token(s).
 *     This is why those three sites are correctly left as hand-rolled spans.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { StatusBadge, statusToneClass } = await import("@/components/ui/StatusBadge");
import type { StatusTone } from "@/components/ui/StatusBadge";

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
const classAttr = (html: string): string => html.match(/class="([^"]*)"/)?.[1] ?? "";
const toSet = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));
const tokenSet = (s: string): string => [...toSet(s)].sort().join(" ");
// React escapes &/</> in text — compare against the escaped form.
const escapeHtml = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// StatusBadge's invariant geometry (verbatim from src/components/ui/StatusBadge.tsx).
const BASE = "rounded-full font-ui font-medium uppercase tracking-wider";
const SIZE: Record<"sm" | "md", string> = {
  sm: "px-2.5 py-1 text-[9px]",
  md: "px-3 py-1 text-[10px]",
};

// Render the REAL component the adopted sites now call.
const badgeSet = (tone: StatusTone, label: string, size: "sm" | "md", className: string): string =>
  tokenSet(
    classAttr(
      renderToStaticMarkup(
        React.createElement(StatusBadge, { tone, label, size, className }),
      ),
    ),
  );

/* =======================================================================
 * A. ADOPTED SITES — new StatusBadge output == git-HEAD original span set
 * ===================================================================== */

// ---- Site 3: /admin/system/privacy-requests StatusPill (size sm, className="shrink-0") ----
// git-HEAD original (verbatim): `shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`
console.log("Adopted — privacy-requests StatusPill (sm, shrink-0)");
{
  // LOCAL map mirroring the file (status -> tone + label).
  const TONE: Record<string, StatusTone> = {
    fulfilled: "green",
    in_progress: "blue",
    pending: "amber",
    partially_fulfilled: "gray",
    rejected: "gray",
    withdrawn: "gray",
  };
  const LABEL: Record<string, string> = {
    pending: "Nieuw", in_progress: "In behandeling", fulfilled: "Afgehandeld",
    partially_fulfilled: "Deels afgehandeld", rejected: "Afgewezen", withdrawn: "Ingetrokken",
  };
  // git-HEAD original tone class per status (verbatim from the pre-refactor file).
  const OLD_TONE: Record<string, string> = {
    fulfilled: "bg-emerald-100 text-emerald-700",
    in_progress: "bg-blue-100 text-blue-700",
    pending: "bg-amber-100 text-amber-800",
    partially_fulfilled: "bg-bg-gray text-ink-500",
    rejected: "bg-bg-gray text-ink-500",
    withdrawn: "bg-bg-gray text-ink-500",
  };
  const oldSet = (s: string): string =>
    tokenSet(`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${OLD_TONE[s]}`);

  for (const s of ["pending", "in_progress", "fulfilled", "partially_fulfilled", "rejected", "withdrawn"]) {
    const html = renderToStaticMarkup(
      React.createElement(StatusBadge, { tone: TONE[s], label: LABEL[s], size: "sm", className: "shrink-0" }),
    );
    const got = tokenSet(classAttr(html));
    const want = oldSet(s);
    assert(`${s}: class set == HEAD`, got === want, got !== want ? `new=[${got}] old=[${want}]` : undefined);
    assert(`${s}: label "${LABEL[s]}" preserved`, html.includes(escapeHtml(LABEL[s])));
  }
}

// ---- Site 5: client RequestStatusBadge (size sm, className="shrink-0") ----
// git-HEAD original (verbatim): `shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${TONE[s] ?? "bg-bg-gray text-ink-500"}`
console.log("Adopted — client RequestStatusBadge (sm, shrink-0)");
{
  const TONE: Record<string, StatusTone> = {
    new: "amber", triaged: "amber", converted: "green",
    rejected: "gray", duplicate: "gray", cancelled_by_client: "gray",
  };
  const LABEL: Record<string, string> = {
    new: "Nieuw aangevraagd", triaged: "In behandeling", converted: "Ingepland",
    rejected: "Afgewezen", duplicate: "In behandeling", cancelled_by_client: "Geannuleerd door jou",
  };
  const OLD_TONE: Record<string, string> = {
    new: "bg-amber-100 text-amber-800",
    triaged: "bg-amber-100 text-amber-800",
    converted: "bg-emerald-100 text-emerald-700",
    rejected: "bg-bg-gray text-ink-500",
    duplicate: "bg-bg-gray text-ink-500",
    cancelled_by_client: "bg-bg-gray text-ink-500",
  };
  const oldSet = (s: string): string =>
    tokenSet(`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${OLD_TONE[s]}`);

  for (const s of ["new", "triaged", "converted", "rejected", "duplicate", "cancelled_by_client"]) {
    const html = renderToStaticMarkup(
      React.createElement(StatusBadge, { tone: TONE[s], label: LABEL[s], size: "sm", className: "shrink-0" }),
    );
    const got = tokenSet(classAttr(html));
    const want = oldSet(s);
    assert(`${s}: class set == HEAD`, got === want, got !== want ? `new=[${got}] old=[${want}]` : undefined);
    assert(`${s}: label "${LABEL[s]}" preserved`, html.includes(escapeHtml(LABEL[s])));
  }
}

/* =======================================================================
 * B. LEFT-UNCHANGED SITES — prove NO StatusBadge call reproduces the original
 *    (would require replacing a conflicting token, but className only APPENDS)
 * ===================================================================== */

// Reproducible iff (BASE ∪ SIZE[size] ∪ tone) ⊆ originalSet for some (size,tone):
// then className = originalSet − that subset (all additive). Returns the
// blocking token(s) (smallest shortfall across all size×tone combos) when NOT.
function reproIssue(originalClass: string): { reproducible: boolean; blockers: string } {
  const orig = toSet(originalClass);
  let best: string[] | null = null;
  for (const size of ["sm", "md"] as const) {
    for (const tone of Object.keys(statusToneClass) as StatusTone[]) {
      const required = toSet(`${BASE} ${SIZE[size]} ${statusToneClass[tone]}`);
      const missing = [...required].filter((t) => !orig.has(t));
      if (missing.length === 0) return { reproducible: true, blockers: "" };
      // track the (size,tone) needing the fewest forbidden replacements
      if (best === null || missing.length < best.length) {
        best = missing.map((m) => `${size}/${tone}:${m}`);
      }
    }
  }
  return { reproducible: false, blockers: (best ?? []).join(", ") };
}

// git-HEAD original tone-class table shared by the two inbox sites.
const INBOX_TONE: Record<string, string> = {
  new: "bg-amber-100 text-amber-700", // <-- amber-700, NOT the tone's amber-800
  triaged: "bg-blue-100 text-blue-700",
  converted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  duplicate: "bg-bg-gray text-ink-500",
};

console.log("Left unchanged — inbox list StatusBadge (HEAD uses text-amber-700)");
{
  // size sm: `rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`
  const r = reproIssue(`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${INBOX_TONE.new}`);
  assert("'new' (amber-700) is NOT reproducible by any tone → leave unchanged", !r.reproducible, `blockers=${r.blockers}`);
}

console.log("Left unchanged — inbox detail StatusBadge (HEAD uses text-amber-700, md)");
{
  // size md: `rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`
  const r = reproIssue(`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${INBOX_TONE.new}`);
  assert("'new' (amber-700, md) is NOT reproducible by any tone → leave unchanged", !r.reproducible, `blockers=${r.blockers}`);
}

console.log("Left unchanged — chef-profile pending pill (px-2 py-0.5, no font-medium)");
{
  // verbatim HEAD: `rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800`
  const r = reproIssue("rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800");
  assert("custom geometry/weight is NOT reproducible → leave unchanged", !r.reproducible, `blockers=${r.blockers}`);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} statusbadge-adoption smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
