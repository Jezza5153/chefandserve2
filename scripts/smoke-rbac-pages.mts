/**
 * RBAC-pages consolidation smoke — proves the UX-primitive consolidation pass
 * over the 6 RBAC/team/user-management pages is faithful, WITHOUT a browser/auth
 * harness (deterministic, fast). Mirrors scripts/smoke-statusbadge-adoption.mts.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/smoke-rbac-pages.mts
 *
 * Method (same as the StatusBadge-adoption smoke): render the shared <StatusBadge>
 * via react-dom/server, extract its class attribute, and compare the Tailwind
 * utility *SET* (order is irrelevant — disjoint utilities, so same-set == same
 * pixels). For fields, expand the literal token-set and compare against fieldClass.
 *
 * OUTCOME OF THIS PASS: on these 6 pages, the strict byte-identical-token-set
 * invariant admits ZERO StatusBadge adoptions and ZERO fieldClass adoptions —
 * every status pill conflicts on a color/geometry token (or is an out-of-scope
 * count chip), and every input/select diverges from fieldClass. So this smoke is
 * entirely a "prove correctly LEFT UNCHANGED" proof, in the same spirit as Part B
 * of the reference smoke.
 *
 * Two kinds of proof:
 *
 *  A. STATUS PILLS — for each candidate we PROVE the original could NOT be
 *     reproduced by ANY StatusBadge call without a conflicting-token append.
 *     StatusBadge always emits  BASE ∪ SIZE[size] ∪ statusToneClass[tone]  plus
 *     purely-additive className tokens. So the original is reproducible iff
 *     (BASE ∪ SIZE[size] ∪ TONE[tone]) ⊆ originalSet for some (size,tone) — a
 *     className can only ADD the leftover tokens, never remove/replace one. We
 *     assert NO such (size,tone) exists and print the blocking token(s).
 *     The single EXCEPTION (system/roles "{n} perms" chip) IS reproducible, but
 *     it is a count chip, not a status→tone pill — explicitly out of scope — so we
 *     assert it is reproducible AND document why it is correctly left as-is.
 *
 *  B. FIELDS — for each <input>/<select>/<textarea> candidate we expand the
 *     literal className token-set and assert it does NOT equal fieldClass (nor
 *     fieldClass ∪ a few allowed extras), proving the field genuinely diverges
 *     (stripped geometry / larger geometry / font-mono / checkbox) and is
 *     correctly left as a hand-rolled class.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { StatusBadge, statusToneClass } = await import("@/components/ui/StatusBadge");
import type { StatusTone } from "@/components/ui/StatusBadge";
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
const classAttr = (html: string): string => html.match(/class="([^"]*)"/)?.[1] ?? "";
const toSet = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));
const tokenSet = (s: string): string => [...toSet(s)].sort().join(" ");

// StatusBadge's invariant geometry (verbatim from src/components/ui/StatusBadge.tsx).
const BASE = "rounded-full font-ui font-medium uppercase tracking-wider";
const SIZE: Record<"sm" | "md", string> = {
  sm: "px-2.5 py-1 text-[9px]",
  md: "px-3 py-1 text-[10px]",
};

// Reproducible iff (BASE ∪ SIZE[size] ∪ tone) ⊆ originalSet for some (size,tone):
// then className = originalSet − that subset (all additive). Returns the blocking
// token(s) (smallest shortfall across all size×tone combos) when NOT reproducible.
function reproIssue(originalClass: string): {
  reproducible: boolean;
  combo?: { size: "sm" | "md"; tone: StatusTone };
  blockers: string;
} {
  const orig = toSet(originalClass);
  let best: string[] | null = null;
  for (const size of ["sm", "md"] as const) {
    for (const tone of Object.keys(statusToneClass) as StatusTone[]) {
      const required = toSet(`${BASE} ${SIZE[size]} ${statusToneClass[tone]}`);
      const missing = [...required].filter((t) => !orig.has(t));
      if (missing.length === 0) return { reproducible: true, combo: { size, tone }, blockers: "" };
      if (best === null || missing.length < best.length) {
        best = missing.map((m) => `${size}/${tone}:${m}`);
      }
    }
  }
  return { reproducible: false, blockers: (best ?? []).join(", ") };
}

/* =======================================================================
 * A. STATUS PILLS — prove each candidate is correctly LEFT UNCHANGED
 *    (or, for the count chip, reproducible-but-out-of-scope).
 * ===================================================================== */

// ---- team/page.tsx:127 — user status pill (px-2 py-0.5, tracking-wide, NO font-ui) ----
// verbatim HEAD: `rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`
// tones: active=emerald-100/700, invited=amber-100/800, else=ink-100/600.
console.log("Left unchanged — team list status pill (px-2 py-0.5, tracking-wide, no font-ui)");
{
  for (const [label, tone] of [
    ["active (emerald)", "bg-emerald-100 text-emerald-700"],
    ["invited (amber-800)", "bg-amber-100 text-amber-800"],
    ["other (ink)", "bg-ink-100 text-ink-600"],
  ] as const) {
    const r = reproIssue(`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`);
    assert(`${label} NOT reproducible → leave unchanged`, !r.reproducible, `blockers=${r.blockers}`);
  }
}

// ---- system/users/page.tsx:244 — local StatusBadge() fn (sm geometry, BUT invited=amber-700) ----
// verbatim HEAD: `rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`
// tones: active=emerald-100/700, invited=amber-100/700 (<-- amber-700, NOT 800), else=bg-gray/ink-500.
// The component is ONE renderer producing all three; since `invited` (amber-700) is
// not reproducible by ANY StatusBadge tone, the whole component must stay hand-rolled.
console.log("Left unchanged — system/users local StatusBadge (HEAD invited uses text-amber-700)");
{
  // active + else ARE individually reproducible (green / gray) — show that...
  const active = reproIssue("rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider bg-emerald-100 text-emerald-700");
  const other = reproIssue("rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider bg-bg-gray text-ink-500");
  assert("active maps to green (reproducible in isolation)", active.reproducible && active.combo?.tone === "green");
  assert("other maps to gray (reproducible in isolation)", other.reproducible && other.combo?.tone === "gray");
  // ...but `invited` (amber-700) is NOT — so the single-renderer component can't be swapped.
  const invited = reproIssue("rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider bg-amber-100 text-amber-700");
  assert("invited (amber-700) NOT reproducible → whole component left unchanged", !invited.reproducible, `blockers=${invited.blockers}`);
}

// ---- team/[id]:156 & users/[id]:333 — "actief" effective-perm pill (rounded, NOT rounded-full) ----
// verbatim HEAD: `ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700`
// StatusBadge always emits `rounded-full`; this uses `rounded` (+ px-1.5 py-0.5, tracking-wide, no font-ui).
console.log("Left unchanged — 'actief' override pill (rounded, px-1.5 py-0.5, tracking-wide)");
{
  const r = reproIssue("rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700");
  assert("NOT reproducible (rounded≠rounded-full + geometry) → leave unchanged", !r.reproducible, `blockers=${r.blockers}`);
}

// ---- system/roles/page.tsx:106 — "{n} perms" COUNT CHIP (reproducible, but out of scope) ----
// verbatim HEAD: `shrink-0 rounded-full bg-burgundy/10 px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-burgundy`
// This DOES exactly equal StatusBadge(tone=burgundy, size=sm, className="shrink-0"),
// but its content is a COUNT ("{held.size} perms"), not a status→tone mapping. The
// task explicitly excludes count chips, so it is correctly left as a hand-rolled span.
console.log("Left unchanged — system/roles '{n} perms' count chip (reproducible, but out of scope)");
{
  const orig = "shrink-0 rounded-full bg-burgundy/10 px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-burgundy";
  const r = reproIssue(orig);
  assert("IS reproducible by StatusBadge(burgundy, sm, shrink-0)", r.reproducible && r.combo?.tone === "burgundy" && r.combo?.size === "sm");
  // confirm the exact equality (render the real component) — documents that the ONLY
  // reason it is left alone is the count-chip exclusion, not a token mismatch.
  const rendered = tokenSet(
    classAttr(
      renderToStaticMarkup(
        React.createElement(StatusBadge, { tone: "burgundy", label: "12 perms", size: "sm", className: "shrink-0" }),
      ),
    ),
  );
  assert("rendered StatusBadge token-set == original chip (count chip → out of scope)", rendered === tokenSet(orig), `rendered=[${rendered}] orig=[${tokenSet(orig)}]`);
}

/* =======================================================================
 * B. FIELDS — prove each input/select/textarea diverges from fieldClass
 *    (so it is correctly left as a hand-rolled class).
 * ===================================================================== */

const FIELD = tokenSet(fieldClass);
const ALLOWED_EXTRAS = ["placeholder-ink-400", "placeholder-ink-500", "mt-1"];
// True iff literal == fieldClass ∪ (subset of allowed extras) — i.e. an ADOPTABLE field.
function isAdoptable(literal: string): boolean {
  const lit = toSet(literal);
  const fc = toSet(fieldClass);
  // every fieldClass token present?
  for (const t of fc) if (!lit.has(t)) return false;
  // every leftover token an allowed extra?
  for (const t of lit) if (!fc.has(t) && !ALLOWED_EXTRAS.includes(t)) return false;
  return true;
}

console.log("Left unchanged — RBAC field inputs (each diverges from fieldClass)");
{
  const FIELDS: Array<{ loc: string; cls: string; why: string }> = [
    {
      loc: "team:87/88, roles:82/83/84 (create-form inputs)",
      cls: "rounded border border-ink-200 px-3 py-2 text-sm",
      why: "no w-full/bg-white/text-ink-900/focus-ring",
    },
    {
      loc: "team/[id]:161, users/[id]:338 (override <select>)",
      cls: "rounded border border-ink-200 px-2 py-1 text-xs text-ink-800",
      why: "px-2 py-1 text-xs text-ink-800, no w-full/bg-white/focus-ring",
    },
    {
      loc: "users/[id]:268 (confirm-email input)",
      cls: "w-full max-w-md rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
      why: "font-mono + max-w-md (excluded)",
    },
    {
      loc: "users/new:114/128 (name/email inputs)",
      cls: "w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
      why: "px-4 py-3 text-base (larger geometry)",
    },
    {
      loc: "users/new:140 (role <select>)",
      cls: "w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
      why: "px-4 py-3 text-base (larger geometry)",
    },
    {
      loc: "team/[id]:131, users/[id]:294, roles:147 (checkboxes)",
      cls: "h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy",
      why: "checkbox geometry (excluded)",
    },
  ];
  for (const f of FIELDS) {
    assert(`${f.loc}: ≠ fieldClass∪extras → leave (${f.why})`, !isAdoptable(f.cls), `tokens=[${tokenSet(f.cls)}]`);
  }
  // sanity-check the matcher itself: fieldClass and a couple ∪-extras forms WOULD be adoptable.
  assert("matcher sanity: bare fieldClass is adoptable", isAdoptable(fieldClass));
  assert("matcher sanity: fieldClass + placeholder-ink-500 is adoptable", isAdoptable(`${fieldClass} placeholder-ink-500`));
  assert("matcher sanity: fieldClass minus a token is NOT adoptable", !isAdoptable(fieldClass.replace(" bg-white", "")));
  void FIELD; // (kept for parity with the reference's token-set vocabulary)
}

console.log(`\n${fail === 0 ? "✅" : "❌"} rbac-pages smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
