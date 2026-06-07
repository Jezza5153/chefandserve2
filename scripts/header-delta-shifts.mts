/**
 * HEADER-DELTA proof for the shifts/[id] DetailShell adoption.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/header-delta-shifts.mts
 *
 * Adopting <DetailShell> for the page header is the ONE allowed visual delta in
 * this refactor (DetailShell has no slot for the shift's subtitle line, and its
 * eyebrow/title chrome differs slightly from the hand-rolled header). This
 * script makes that delta explicit and reviewable:
 *
 *   - renders the OLD header (reconstructed from the baseline JSX, standalone,
 *     with mock data) via react-dom/server,
 *   - renders the NEW header (the real <DetailShell> as the page now uses it,
 *     same mock data),
 *   - writes _harness/header-old.html + _harness/header-new.html (git-excluded),
 *   - prints a concise, human-readable summary of exactly what changed.
 *
 * StatusBadge + formatDateRange are unchanged by the refactor; identical copies
 * are inlined on BOTH sides so the diff isolates the header chrome that
 * DetailShell owns. Rendering uses React.createElement (no raw JSX) to match the
 * repo's other .mts render smokes — esbuild keys the JSX loader off file
 * extension, and .mts is parsed as plain TS. next/link renders fine under tsx
 * (→ plain <a href>), so no stub is needed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = React.createElement;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(ROOT, "_harness");

const { DetailShell } = await import("@/components/ui/DetailShell");

// ---- mock shift (mirrors the real page's data shape for the header) --------
const shift = {
  roleNeeded: "Souschef",
  segment: "Fine dining",
  status: "open",
  clientId: "client-123",
  city: "Amsterdam",
  startsAt: new Date("2026-06-12T17:00:00+02:00"),
  endsAt: new Date("2026-06-12T23:30:00+02:00"),
};
const client = { companyName: "Hotel De Kroon" };

// ---- helpers, copied verbatim from page.tsx (unchanged by the refactor) ----
function statusBadge(status: string) {
  const tone =
    status === "open"
      ? "bg-amber-100 text-amber-700"
      : status === "filled"
        ? "bg-emerald-100 text-emerald-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : status === "cancelled"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return h(
    "span",
    {
      className: `rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`,
    },
    status,
  );
}

function formatDateRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

// shared title content (verbatim role + segment span)
const titleContent = h(
  React.Fragment,
  null,
  shift.roleNeeded,
  shift.segment ? h("span", { className: "ml-2 text-ink-500" }, "· ", shift.segment) : null,
);

// shared subtitle line (client link · date range · city) — content preserved
const subtitle = h(
  "p",
  { className: "mt-2 text-sm text-ink-700" },
  h(
    "a",
    {
      href: `/admin/business/clients/${shift.clientId}`,
      className: "text-burgundy underline-offset-4 hover:underline",
    },
    client?.companyName ?? "(klant verwijderd)",
  ),
  " · ",
  formatDateRange(shift.startsAt, shift.endsAt),
  shift.city ? ` · ${shift.city}` : null,
);

// ---- OLD header — reconstructed verbatim from the baseline JSX --------------
const oldHeader = h(
  "div",
  { className: "mx-auto max-w-5xl" },
  h(
    "div",
    { className: "mb-6" },
    h(
      "a",
      {
        href: "/admin/business/shifts",
        className: "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline",
      },
      "← Shifts",
    ),
  ),
  h(
    "div",
    { className: "flex items-start justify-between gap-4" },
    h(
      "div",
      null,
      h(
        "p",
        { className: "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy" },
        "Shift",
      ),
      h("h1", { className: "mt-2 font-serif text-3xl text-ink-900 md:text-4xl" }, titleContent),
      subtitle,
    ),
    statusBadge(shift.status),
  ),
);

// ---- NEW header — the real DetailShell, exactly as page.tsx now uses it -----
const newHeader = h(
  DetailShell,
  {
    className: "mx-auto max-w-5xl",
    backHref: "/admin/business/shifts",
    backLabel: "Shifts",
    eyebrow: "Shift",
    title: titleContent,
    actions: statusBadge(shift.status),
  },
  subtitle,
);

const oldHtml = renderToStaticMarkup(oldHeader);
const newHtml = renderToStaticMarkup(newHeader);

mkdirSync(HARNESS, { recursive: true });
const wrap = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>\n${body}\n</body></html>\n`;
writeFileSync(join(HARNESS, "header-old.html"), wrap("shift header — OLD", oldHtml));
writeFileSync(join(HARNESS, "header-new.html"), wrap("shift header — NEW (DetailShell)", newHtml));

// ---- diff summary ----------------------------------------------------------
console.log(`\nHEADER DELTA — shifts/[id] DetailShell adoption`);
console.log(`wrote: _harness/header-old.html  +  _harness/header-new.html\n`);

console.log(`Same on both sides (no change):`);
console.log(`  • back-link text + classes: "← Shifts" / font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline`);
console.log(`  • <h1> title content: "${shift.roleNeeded}" + "· ${shift.segment}" span (ml-2 text-ink-500)`);
console.log(`  • StatusBadge pill (actions): identical markup + tone`);
console.log(`  • subtitle text: client link · date range · city  (content preserved, NOT dropped)`);

console.log(`\nChanged (the allowed header delta — DetailShell owns this chrome):`);

console.log(`  1. Header-row wrapper`);
console.log(`       OLD: a bare back-link <div class="mb-6"> THEN a separate`);
console.log(`            <div class="flex items-start justify-between gap-4"> for title+badge`);
console.log(`       NEW: one DetailShell row <div class="mb-6 flex flex-wrap items-start justify-between gap-3">`);
console.log(`            (back-link, eyebrow + title in the left column; badge wrapped in`);
console.log(`             <div class="flex shrink-0 items-center gap-2"> on the right)`);

const oldEyebrow = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";
const newEyebrow = "mt-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500";
console.log(`  2. Eyebrow "Shift"`);
console.log(`       OLD class: ${oldEyebrow}`);
console.log(`       NEW class: ${newEyebrow}`);
console.log(`       → color burgundy → ink-500; size text-[11px] → text-[10px]; gains mt-2`);

console.log(`  3. <h1> title top margin`);
console.log(`       OLD: mt-2 font-serif text-3xl text-ink-900 md:text-4xl`);
console.log(`       NEW: mt-1 font-serif text-3xl text-ink-900 md:text-4xl   (mt-2 → mt-1)`);

console.log(`  4. Subtitle line (client · date · city)`);
console.log(`       OLD: nested in the header's left column, directly under the <h1>`);
console.log(`       NEW: rendered as DetailShell's first child — just BELOW the header row,`);
console.log(`            since DetailShell has no subtitle slot (content unchanged)`);

// programmatic confirmation against the actually-rendered HTML
const checks: Array<[string, boolean]> = [
  ["OLD eyebrow class present in old html", oldHtml.includes(oldEyebrow)],
  ["NEW eyebrow class present in new html", newHtml.includes(newEyebrow)],
  ["OLD <h1> uses mt-2", oldHtml.includes('class="mt-2 font-serif text-3xl text-ink-900 md:text-4xl"')],
  ["NEW <h1> uses mt-1", newHtml.includes('class="mt-1 font-serif text-3xl text-ink-900 md:text-4xl"')],
  ["back-link '← Shifts' present in both", oldHtml.includes("← Shifts") && newHtml.includes("← Shifts")],
  [`subtitle '${client.companyName}' present in both`, oldHtml.includes(client.companyName) && newHtml.includes(client.companyName)],
  ["new header wraps actions in flex shrink-0", newHtml.includes("flex shrink-0 items-center gap-2")],
];
console.log(`\nRendered-HTML confirmation:`);
for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);

console.log(
  `\nNet: identical content; only header chrome moved into DetailShell. ` +
    `No behavior / action / Dutch-text change. This is the single sign-off delta.\n`,
);
