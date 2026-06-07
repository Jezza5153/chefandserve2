/**
 * HEADER DELTA harness for the clients/[id] refactor.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/header-delta-clients.mts
 *
 * Adopting the shared <DetailShell> for the page header is the ONE allowed
 * visual change in this refactor (RULE 5). This harness renders BOTH headers
 * with identical mock data via react-dom/server, writes them to _harness/ for
 * eyeball/diff, and prints a concise human-readable summary of exactly what the
 * DetailShell adoption changed — so the delta can be signed off.
 *
 *  • OLD header = the pre-refactor header JSX, reproduced verbatim from
 *    origin/feat/monolith-consolidation (back-link row + title block + StatusBadge).
 *  • NEW header = the REAL <DetailShell> (imported from source) wired exactly as
 *    the new page.tsx wires it, with the "Toegevoegd …" subtitle as its first child.
 *
 * `next/link` is stubbed to a plain <a href> (DetailShell imports it; Next's Link
 * doesn't resolve under tsx's ESM loader). The stub is registered in-process so
 * the documented command above works with no extra flags.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

// --- self-bootstrap the next/link stub + resolve hook (so this script needs no
//     extra flags and no committed helper files; _harness/ is git-excluded) ---
mkdirSync("_harness", { recursive: true });
writeFileSync(
  "_harness/next-link-stub.mjs",
  `import { jsx } from "react/jsx-runtime";
export default function Link({ href, children, ...rest }) {
  return jsx("a", { href: typeof href === "string" ? href : String(href), ...rest, children });
}
`,
);
writeFileSync(
  "_harness/next-link-hook.mjs",
  `import { pathToFileURL } from "node:url";
import { resolve as pathResolve } from "node:path";
const STUB = pathToFileURL(pathResolve(process.cwd(), "_harness/next-link-stub.mjs")).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/link") return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
`,
);
register(pathToFileURL(pathResolve(process.cwd(), "_harness/next-link-hook.mjs")).href);

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { DetailShell } = await import("@/components/ui/DetailShell");

// ---- shared mock data (same for both headers) ----
const MOCK = {
  companyName: "Hotel Okura Amsterdam",
  status: "prospect",
  joinedAt: new Date("2025-11-01T09:00:00Z"),
  sourceSubmissionId: "sub_demo_123",
};

const joinedLabel = MOCK.joinedAt.toLocaleDateString("nl-NL", { dateStyle: "long" });

// This harness uses React.createElement (not JSX) so it runs under tsx's `.mts`
// loader, matching the repo's other render smokes (e.g. smoke-ux-primitives.mts).
const h = React.createElement;

// A plain <a> Link stub for the OLD header (next/link → <a href>).
const Link = (props: { href: string; className?: string; children: React.ReactNode }) =>
  h("a", { href: props.href, className: props.className }, props.children);

// StatusBadge — verbatim copy of the badge that still lives in page.tsx.
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "prospect"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    prospect: "Prospect",
    active: "Actief",
    paused: "Gepauzeerd",
    archived: "Gearchiveerd",
  };
  return h(
    "span",
    { className: `rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}` },
    labels[status] ?? status,
  );
}

// The shared "Toegevoegd <datum> · via inbox" subtitle (identical markup both sides).
const subtitle = () =>
  h(
    "p",
    { className: "mt-1 text-xs text-ink-500" },
    "Toegevoegd ",
    joinedLabel,
    h(
      React.Fragment,
      null,
      " · ",
      h(
        Link,
        {
          href: `/admin/business/inbox/client/${MOCK.sourceSubmissionId}`,
          className: "text-burgundy underline-offset-4 hover:underline",
        },
        "via inbox",
      ),
    ),
  );

// ---- OLD header — verbatim reproduction of the pre-refactor header JSX ----
function OldHeader() {
  return h(
    "div",
    { className: "mx-auto max-w-3xl" },
    h(
      "div",
      { className: "mb-6" },
      h(
        Link,
        {
          href: "/admin/business/clients",
          className: "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline",
        },
        "← Alle klanten",
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
          "Klant-profiel",
        ),
        h("h1", { className: "mt-2 font-serif text-3xl text-ink-900 md:text-4xl" }, MOCK.companyName),
        subtitle(),
      ),
      h(StatusBadge, { status: MOCK.status }),
    ),
  );
}

// ---- NEW header — the real DetailShell, wired exactly as the new page.tsx ----
function NewHeader() {
  return h(
    DetailShell,
    {
      className: "mx-auto max-w-3xl",
      backHref: "/admin/business/clients",
      backLabel: "Alle klanten",
      eyebrow: "Klant-profiel",
      title: MOCK.companyName,
      actions: h(StatusBadge, { status: MOCK.status }),
    },
    subtitle(),
  );
}

const oldHtml = renderToStaticMarkup(h(OldHeader));
const newHtml = renderToStaticMarkup(h(NewHeader));

const wrap = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>\n<!-- ${title} — mock render, classes are Tailwind tokens (no CSS attached) -->\n${body}\n`;
writeFileSync("_harness/header-old.html", wrap("clients header — OLD (pre-refactor)", oldHtml));
writeFileSync("_harness/header-new.html", wrap("clients header — NEW (DetailShell)", newHtml));

// ---- human-readable summary of the delta ----
const cls = (html: string, re: RegExp) => html.match(re)?.[1] ?? "(none)";

console.log("HEADER DELTA — clients/[id] DetailShell adoption\n");
console.log("Wrote _harness/header-old.html and _harness/header-new.html (git-excluded).\n");

console.log("Same in both (no change):");
console.log("  • Back-link text + classes: '← Alle klanten', font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline");
console.log("  • Eyebrow TEXT: 'Klant-profiel'");
console.log("  • H1 TEXT + font: company name, font-serif text-3xl text-ink-900 md:text-4xl");
console.log("  • Outer container width: mx-auto max-w-3xl (passed through DetailShell `className`)");
console.log("  • StatusBadge (amber 'Prospect' pill): unchanged — moved into the DetailShell `actions` slot");
console.log("  • Subtitle 'Toegevoegd <datum> · via inbox' with the burgundy inbox link: PRESERVED (nothing dropped)\n");

console.log("Changed by DetailShell (the allowed delta):");
console.log("  1. BACK-LINK POSITION — was its own row in a `<div class=\"mb-6\">` ABOVE the title;");
console.log("     now it sits stacked directly above the eyebrow inside DetailShell's left column");
console.log("     (header row: `mb-6 flex flex-wrap items-start justify-between gap-3`).");
console.log("  2. EYEBROW STYLING — recoloured + resized:");
console.log(`        OLD eyebrow class: ${cls(oldHtml, /<p class="([^"]*)">\s*Klant-profiel/)}`);
console.log(`        NEW eyebrow class: ${cls(newHtml, /<p class="([^"]*)">Klant-profiel/)}`);
console.log("        → burgundy → ink-500, text-[11px] → text-[10px], gains `mt-2`.");
console.log("  3. H1 TOP MARGIN — `mt-2` (old) → `mt-1` (DetailShell).");
console.log(`        OLD h1 class: ${cls(oldHtml, /<h1 class="([^"]*)"/)}`);
console.log(`        NEW h1 class: ${cls(newHtml, /<h1 class="([^"]*)"/)}`);
console.log("  4. TITLE-ROW WRAPPER — old `flex items-start justify-between gap-4` (no wrap) →");
console.log("     DetailShell `mb-6 flex flex-wrap items-start justify-between gap-3` (wraps, gap-4→gap-3),");
console.log("     and the StatusBadge is wrapped in `flex shrink-0 items-center gap-2` (actions slot).");
console.log("  5. SUBTITLE POSITION — the 'Toegevoegd …' <p> was the 3rd line inside the title column;");
console.log("     it is now the first child rendered BELOW the header row (its own `mt-1 text-xs text-ink-500`");
console.log("     is unchanged). Same content + link, slightly different vertical placement.\n");

console.log("Net: text/links/badge content identical and nothing dropped; the deltas are header CHROME");
console.log("(eyebrow colour+size, h1/back-link placement, row gap) that DetailShell owns by design.");

// Sanity asserts so the harness fails loudly if a header drifts unexpectedly.
let fail = 0;
const must = (name: string, cond: boolean) => {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`);
  if (!cond) fail++;
};
console.log("\nSanity checks:");
must("OLD eyebrow is burgundy text-[11px]", /<p class="[^"]*text-\[11px\][^"]*text-burgundy[^"]*">\s*Klant-profiel/.test(oldHtml));
must("NEW eyebrow is ink-500 text-[10px]", /<p class="[^"]*text-\[10px\][^"]*text-ink-500[^"]*">Klant-profiel/.test(newHtml));
must("OLD h1 has mt-2", /<h1 class="mt-2 /.test(oldHtml));
must("NEW h1 has mt-1", /<h1 class="mt-1 /.test(newHtml));
must("both keep the 'via inbox' link", oldHtml.includes("via inbox") && newHtml.includes("via inbox"));
must("both keep 'Toegevoegd' subtitle", oldHtml.includes("Toegevoegd") && newHtml.includes("Toegevoegd"));
must("both render the Prospect badge", oldHtml.includes("Prospect") && newHtml.includes("Prospect"));
must("both keep back-link '← Alle klanten'", oldHtml.includes("← Alle klanten") && newHtml.includes("← Alle klanten"));

console.log(`\n${fail === 0 ? "✅" : "❌"} header-delta harness: ${fail === 0 ? "rendered + summarized" : `${fail} sanity check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
