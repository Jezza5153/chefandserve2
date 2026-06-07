/**
 * Header-delta harness for the chefs/[id] DetailShell adoption.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/header-delta-chefs.mts
 *
 * Renders the OLD page header (verbatim markup from the baseline page) and the NEW
 * DetailShell-based header with the SAME mock chef, via react-dom/server, writes both
 * to _harness/header-old.html + _harness/header-new.html (the _harness/ dir is
 * git-excluded), and prints a concise human-readable summary of what changed.
 *
 * The DetailShell header is rendered via the REAL shared component
 * (@/components/ui/DetailShell) so the diff reflects production output. `next/link`
 * is stubbed to a plain <a href> so both renders run outside Next. Markup is built
 * with React.createElement (aliased `h`) — esbuild does not parse JSX in a `.mts`
 * file, matching the convention of the other render-based smokes in this repo.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const h = React.createElement;
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "_harness");

// ---- next/link stub (plain anchor) ------------------------------------------
function Link({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return h("a", { href, className }, children);
}

// ---- mock data --------------------------------------------------------------
const chef = {
  fullName: "Jan de Vries",
  status: "active",
  joinedAt: new Date("2026-02-14T10:00:00Z"),
};
const sourceSubmission = { id: "sub_123" };

// StatusBadge — shared verbatim by both renders (NOT what the delta is about).
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "onboarding"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    onboarding: "Onboarding",
    active: "Actief",
    paused: "Gepauzeerd",
    inactive: "Inactief",
    archived: "Gearchiveerd",
  };
  return h(
    "span",
    {
      className: `rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`,
    },
    labels[status] ?? status,
  );
}

// The "Toegevoegd … via inbox" subtitle — identical node in both renders; only its
// POSITION differs (inside the header's left column before; first child after).
function Subtitle() {
  return h(
    "p",
    { className: "mt-1 text-xs text-ink-500" },
    "Toegevoegd ",
    new Date(chef.joinedAt).toLocaleDateString("nl-NL", { dateStyle: "long" }),
    sourceSubmission
      ? h(
          React.Fragment,
          null,
          " · ",
          h(
            Link,
            {
              href: `/admin/business/inbox/chef/${sourceSubmission.id}`,
              className: "text-burgundy underline-offset-4 hover:underline",
            },
            "via inbox",
          ),
        )
      : null,
  );
}

// ---- OLD header — verbatim structure from baseline page.tsx (~L469-506) ------
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
          href: "/admin/business/chefs",
          className:
            "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline",
        },
        "← Alle chefs",
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
          {
            className:
              "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy",
          },
          "Chef-profiel",
        ),
        h(
          "h1",
          { className: "mt-2 font-serif text-3xl text-ink-900 md:text-4xl" },
          chef.fullName,
        ),
        h(Subtitle, null),
      ),
      h(StatusBadge, { status: chef.status }),
    ),
  );
}

async function main() {
  // NEW header — the real shared DetailShell, configured exactly as page.tsx does,
  // with the subtitle as its first child (DetailShell has no subtitle slot).
  const { DetailShell } = await import("@/components/ui/DetailShell");

  const oldHtml = renderToStaticMarkup(h(OldHeader, null));
  const newHtml = renderToStaticMarkup(
    h(
      DetailShell,
      {
        className: "mx-auto max-w-3xl",
        backHref: "/admin/business/chefs",
        backLabel: "Alle chefs",
        eyebrow: "Chef-profiel",
        title: chef.fullName,
        actions: h(StatusBadge, { status: chef.status }),
      },
      h(Subtitle, null),
    ),
  );

  mkdirSync(OUT, { recursive: true });
  const wrap = (title: string, body: string) =>
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title>` +
    `<script src="https://cdn.tailwindcss.com"></script></head>` +
    `<body class="p-8 bg-white">${body}</body></html>`;
  writeFileSync(join(OUT, "header-old.html"), wrap("OLD header", oldHtml));
  writeFileSync(join(OUT, "header-new.html"), wrap("NEW header (DetailShell)", newHtml));

  // ---- human-readable summary of the delta ----------------------------------
  console.log("\n=== Chefs [id] header delta: custom header → DetailShell ===\n");
  console.log("Wrote _harness/header-old.html and _harness/header-new.html\n");

  console.log("Preserved (no change):");
  console.log("  • Page container width   : both use `mx-auto max-w-3xl`");
  console.log("  • Back-link text + style : `← Alle chefs`, font-ui text-[11px] burgundy hover:underline");
  console.log("  • H1 title               : `Jan de Vries`, font-serif text-3xl text-ink-900 md:text-4xl");
  console.log("  • StatusBadge            : unchanged pill, now placed in DetailShell's actions slot");
  console.log("  • Subtitle CONTENT       : `Toegevoegd … · via inbox` — same text + classes, NOT dropped\n");

  console.log("Changed (the single allowed visual delta of adopting DetailShell):");
  console.log("  1. Back-link position : OLD = standalone `<div class=\"mb-6\">` ABOVE the header row;");
  console.log("                          NEW = first item INSIDE the header row's left column.");
  console.log("  2. Eyebrow style      : OLD `Chef-profiel` = text-[11px] text-burgundy;");
  console.log("                          NEW = text-[10px] text-ink-500  ← smaller + grey, no longer burgundy.");
  console.log("  3. H1 top margin      : OLD `mt-2` → NEW `mt-1` (tighter eyebrow→title gap).");
  console.log("  4. Header row flexbox : OLD `flex items-start justify-between gap-4`;");
  console.log("                          NEW `mb-6 flex flex-wrap items-start justify-between gap-3` (+flex-wrap, gap-3),");
  console.log("                          StatusBadge wrapper `flex shrink-0 items-center gap-2` (items-center vs -start).");
  console.log("  5. Subtitle position  : OLD inside header left column, directly under H1;");
  console.log("                          NEW first child of DetailShell, just below the whole header block.\n");

  // Machine-checked assertions so the prose summary can't silently drift.
  const checks: [string, boolean][] = [
    ["NEW eyebrow is text-[10px] text-ink-500", /text-\[10px\][^"]*text-ink-500/.test(newHtml)],
    ["OLD eyebrow is text-[11px] text-burgundy", /font-ui text-\[11px\] uppercase tracking-\[0\.18em\] text-burgundy">Chef-profiel/.test(oldHtml)],
    ["NEW H1 uses mt-1", /class="mt-1 font-serif text-3xl/.test(newHtml)],
    ["OLD H1 uses mt-2", /class="mt-2 font-serif text-3xl/.test(oldHtml)],
    ["both render the 'via inbox' link", oldHtml.includes(">via inbox</a>") && newHtml.includes(">via inbox</a>")],
    ["both render StatusBadge label 'Actief'", oldHtml.includes(">Actief</span>") && newHtml.includes(">Actief</span>")],
    ["NEW header row uses flex-wrap gap-3", newHtml.includes("mb-6 flex flex-wrap items-start justify-between gap-3")],
    ["OLD header row uses gap-4 (no wrap)", oldHtml.includes("flex items-start justify-between gap-4")],
    ["both keep container mx-auto max-w-3xl", oldHtml.includes('class="mx-auto max-w-3xl"') && newHtml.includes('class="mx-auto max-w-3xl"')],
  ];
  console.log("Machine-checked:");
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) bad++;
  }
  console.log("");
  if (bad > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
