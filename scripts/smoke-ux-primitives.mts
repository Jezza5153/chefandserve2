/**
 * Phase-0 UX-primitives smoke — proves the shared primitives + KPI-5 cockpit money
 * strip are visually faithful, WITHOUT a browser/auth harness (deterministic, fast).
 *
 *   npx tsx scripts/smoke-ux-primitives.mts
 *
 * Proves:
 *  - StatusBadge tone vocabulary == the verbatim 6-tone palette.
 *  - HumanStatusBadge (now rendering via StatusBadge) produces the SAME Tailwind
 *    utility SET as the git-HEAD original for every HoursStatus. (Token ORDER may
 *    differ — irrelevant: CSS is order-independent for these disjoint utilities, so
 *    same-set == zero pixel change. The Dutch label is preserved too.)
 *  - MoneyStrip renders all 3 windows (week/maand/YTD) with euro-formatted money.
 *  - getPlatformRollups() (dev DB) returns the {week,month,ytd} MoneyWindow shape
 *    the cockpit strip consumes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { statusToneClass } = await import("@/components/ui/StatusBadge");
const { HumanStatusBadge } = await import("@/components/hours/HumanStatusBadge");
const { MoneyStrip } = await import("@/components/dashboard/MoneyStrip");
const { statusTone, humanStatus } = await import("@/lib/hours-labels");

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
const tokenSet = (s: string): string => s.split(/\s+/).filter(Boolean).sort().join(" ");
// React escapes &/</> in text — compare against the escaped form (e.g. "Chef & Serve" → "Chef &amp; Serve").
const escapeHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- 1. tone vocabulary is the verbatim 6-tone palette ----
console.log("StatusBadge tone vocabulary");
const EXPECTED_TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-700",
  burgundy: "bg-burgundy/10 text-burgundy",
  red: "bg-red-100 text-red-700",
  gray: "bg-bg-gray text-ink-500",
};
for (const [tone, cls] of Object.entries(EXPECTED_TONES)) {
  assert(`statusToneClass.${tone} == "${cls}"`, statusToneClass[tone as keyof typeof statusToneClass] === cls, statusToneClass[tone as keyof typeof statusToneClass]);
}

// ---- 2. HumanStatusBadge utility-set identical to git-HEAD original ----
console.log("HumanStatusBadge refactor (zero pixel change)");
// Verbatim from `git show HEAD:src/components/hours/HumanStatusBadge.tsx` (pre-refactor):
const OLD_TONE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-700",
  burgundy: "bg-burgundy/10 text-burgundy",
  gray: "bg-bg-gray text-ink-500",
};
const oldBadgeClass = (status: string): string =>
  `rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${OLD_TONE[statusTone(status as never)]}`;

const STATUSES = ["draft", "submitted", "client_signed", "client_rejected", "admin_approved", "admin_rejected", "exported", "void"];
let setMismatch = 0;
let labelMismatch = 0;
for (const s of STATUSES) {
  const html = renderToStaticMarkup(React.createElement(HumanStatusBadge, { status: s as never }));
  const newSet = tokenSet(classAttr(html));
  const oldSet = tokenSet(oldBadgeClass(s));
  if (newSet !== oldSet) {
    setMismatch++;
    console.log(`    MISMATCH ${s}:\n      new=[${newSet}]\n      old=[${oldSet}]`);
  }
  if (!html.includes(escapeHtml(humanStatus(s as never)))) labelMismatch++;
}
assert("utility SET identical to git-HEAD for all 8 statuses", setMismatch === 0, `${setMismatch} mismatch(es)`);
assert("Dutch label preserved for all 8 statuses", labelMismatch === 0, `${labelMismatch} missing`);

// ---- 3. MoneyStrip renders 3 windows + euro formatting ----
console.log("MoneyStrip (KPI-5 cockpit strip)");
const w = (rev: number, loon: number) => ({ revenueCents: rev, loonCostCents: loon, marginCents: rev - loon });
const stripHtml = renderToStaticMarkup(
  React.createElement(MoneyStrip, { week: w(123400, 80000), month: w(5600000, 3000000), ytd: w(98765400, 50000000) }),
);
assert('shows "Deze week"', stripHtml.includes("Deze week"));
assert('shows "Laatste 30 dagen"', stripHtml.includes("Laatste 30 dagen"));
assert('shows "Dit jaar"', stripHtml.includes("Dit jaar"));
assert("formats euros (€ present)", stripHtml.includes("€"));
assert('labels "marge" + "loonkost"', stripHtml.toLowerCase().includes("marge") && stripHtml.toLowerCase().includes("loonkost"));

// ---- 4. getPlatformRollups shape (dev DB) ----
console.log("getPlatformRollups data feed (dev DB)");
try {
  const { getPlatformRollups } = await import("@/lib/domain/platform-rollups");
  const roll = (await getPlatformRollups()) as Record<string, { revenueCents: number; loonCostCents: number; marginCents: number }>;
  const okShape = ["week", "month", "ytd"].every(
    (k) => roll[k] && typeof roll[k].revenueCents === "number" && typeof roll[k].loonCostCents === "number" && typeof roll[k].marginCents === "number",
  );
  assert("returns {week,month,ytd} MoneyWindow shape", okShape, JSON.stringify(roll));
} catch (e) {
  console.log("  ⚠ getPlatformRollups skipped (no DB):", e instanceof Error ? e.message : String(e));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ux-primitives smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
