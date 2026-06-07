/**
 * RENDER-PROOF DELTA for the RBAC-pages UI-primitive normalization.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json scripts/rbac-normalize-delta.mts
 *
 * This is an INTENTIONAL visual normalization (StatusBadge / fieldClass /
 * DataTable adoption), so there is no zero-pixel gate. Instead this script makes
 * the delta explicit + reviewable, and PROVES that no rendered data value or
 * href was dropped between BEFORE and AFTER.
 *
 * For each changed region it:
 *   - renders the BEFORE markup (reconstructed verbatim from the origin/main
 *     baseline, standalone, with mock data) via react-dom/server,
 *   - renders the AFTER markup using the REAL shipped primitives
 *     (StatusBadge / DataTable / fieldClass), same mock data,
 *   - writes _harness/<page>-before.html + _harness/<page>-after.html
 *     (the _harness/ dir is git-excluded),
 *   - asserts every data value + href present in BEFORE is also in AFTER,
 *   - prints a concise human-readable description of the visual delta.
 *
 * Rendering uses React.createElement (no raw JSX) to match the repo's other
 * .mts render smokes — esbuild keys the JSX loader off file extension, and
 * .mts is parsed as plain TS. next/link renders fine under tsx (→ <a href>),
 * so no stub is needed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = React.createElement;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(ROOT, "_harness");
mkdirSync(HARNESS, { recursive: true });

// ---- REAL shipped primitives (the AFTER side renders these) ----------------
const { StatusBadge } = await import("@/components/ui/StatusBadge");
const { DataTable } = await import("@/components/ui/DataTable");
const { fieldClass } = await import("@/components/forms/Fields");

type Region = {
  page: string;
  before: React.ReactNode;
  after: React.ReactNode;
  /** strings that MUST survive into the AFTER html (data values + hrefs) */
  mustSurvive: string[];
  /** plain-language description lines of the visual delta */
  delta: string[];
};

/** Decode the entities renderToStaticMarkup emits, so .includes() can match raw
 * substrings (e.g. apostrophes → &#x27;, & → &amp;) in mustSurvive checks. */
const decodeEntities = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const wrap = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
  `<script src="https://cdn.tailwindcss.com"></script></head>` +
  `<body class="p-6 bg-white">\n${body}\n</body></html>\n`;

/* =================================================================== *
 * PAGE 1 — business/team/page.tsx : status pill + create-form + table
 * =================================================================== */
function teamList(): Region {
  // mock employees (mirrors the `internal` select shape)
  const internal = [
    { id: "u1", name: "Maarten Hogeveen", email: "maarten@chefandserve.nl", status: "active" },
    { id: "u2", name: "Lisa Spols", email: "lisa@chefandserve.nl", status: "invited" },
    { id: "u3", name: "Onbekend", email: "x@chefandserve.nl", status: "suspended" },
  ];
  const rolesByUser = new Map<string, string[]>([
    ["u1", ["owner"]],
    ["u2", ["planner"]],
  ]);
  const STATUS_TONE: Record<string, "green" | "amber"> = { active: "green", invited: "amber" };

  // ----- BEFORE: verbatim hand-rolled table + inline pill ------------------
  const beforeRows = internal.map((u) =>
    h(
      "tr",
      { key: u.id },
      h(
        "td",
        { className: "px-4 py-3" },
        h("p", { className: "font-medium text-ink-900" }, u.name),
        h("p", { className: "text-xs text-ink-500" }, u.email),
      ),
      h(
        "td",
        { className: "px-4 py-3 text-ink-700" },
        (rolesByUser.get(u.id) ?? []).join(", ") || h("span", { className: "text-ink-400" }, "—"),
      ),
      h(
        "td",
        { className: "px-4 py-3" },
        h(
          "span",
          {
            className: `rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${u.status === "active" ? "bg-emerald-100 text-emerald-700" : u.status === "invited" ? "bg-amber-100 text-amber-800" : "bg-ink-100 text-ink-600"}`,
          },
          u.status,
        ),
      ),
      h(
        "td",
        { className: "px-4 py-3 text-right" },
        h(
          "a",
          { href: `/admin/business/team/${u.id}`, className: "font-ui text-[12px] font-medium text-burgundy hover:underline" },
          "Beheren →",
        ),
      ),
    ),
  );
  const before = h(
    React.Fragment,
    null,
    // create-form inputs (before)
    h(
      "form",
      { className: "mt-4 grid gap-3 sm:grid-cols-2" },
      h("input", { name: "name", placeholder: "Volledige naam", className: "rounded border border-ink-200 px-3 py-2 text-sm" }),
      h("input", { name: "email", placeholder: "E-mailadres", className: "rounded border border-ink-200 px-3 py-2 text-sm" }),
      h(
        "select",
        { name: "roleKey", defaultValue: "", className: "rounded border border-ink-200 px-3 py-2 text-sm" },
        h("option", { value: "", disabled: true }, "Kies een rol…"),
      ),
    ),
    h(
      "div",
      { className: "mt-6 overflow-hidden rounded-lg border border-ink-200 bg-white" },
      h(
        "table",
        { className: "w-full text-sm" },
        h(
          "thead",
          { className: "bg-bg-gray text-left font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500" },
          h(
            "tr",
            null,
            h("th", { className: "px-4 py-2.5" }, "Naam"),
            h("th", { className: "px-4 py-2.5" }, "Rollen"),
            h("th", { className: "px-4 py-2.5" }, "Status"),
            h("th", { className: "px-4 py-2.5" }),
          ),
        ),
        h("tbody", { className: "divide-y divide-ink-100" }, ...beforeRows),
      ),
    ),
  );

  // ----- AFTER: real fieldClass + StatusBadge + DataTable ------------------
  type Row = (typeof internal)[number];
  const after = h(
    React.Fragment,
    null,
    h(
      "form",
      { className: "mt-4 grid gap-3 sm:grid-cols-2" },
      h("input", { name: "name", placeholder: "Volledige naam", className: fieldClass }),
      h("input", { name: "email", placeholder: "E-mailadres", className: fieldClass }),
      h(
        "select",
        { name: "roleKey", defaultValue: "", className: fieldClass },
        h("option", { value: "", disabled: true }, "Kies een rol…"),
      ),
    ),
    h(DataTable<Row>, {
      className: "mt-6",
      rows: internal,
      getRowKey: (u: Row) => u.id,
      columns: [
        {
          key: "name",
          header: "Naam",
          cell: (u: Row) =>
            h(
              React.Fragment,
              null,
              h("p", { className: "font-medium text-ink-900" }, u.name),
              h("p", { className: "text-xs text-ink-500" }, u.email),
            ),
        },
        {
          key: "roles",
          header: "Rollen",
          cell: (u: Row) =>
            (rolesByUser.get(u.id) ?? []).join(", ") || h("span", { className: "text-ink-400" }, "—"),
        },
        {
          key: "status",
          header: "Status",
          cell: (u: Row) => h(StatusBadge, { tone: STATUS_TONE[u.status] ?? "gray", label: u.status }),
        },
        {
          key: "actions",
          header: "",
          align: "right" as const,
          cell: (u: Row) =>
            h(
              "a",
              { href: `/admin/business/team/${u.id}`, className: "font-ui text-[12px] font-medium text-burgundy hover:underline" },
              "Beheren →",
            ),
        },
      ],
    }),
  );

  return {
    page: "team-list",
    before,
    after,
    mustSurvive: [
      "Maarten Hogeveen", "maarten@chefandserve.nl", "active",
      "Lisa Spols", "invited", "suspended", "owner", "planner",
      "/admin/business/team/u1", "/admin/business/team/u2", "/admin/business/team/u3",
      "Beheren →", "Naam", "Rollen", "Status", "Volledige naam", "Kies een rol…",
    ],
    delta: [
      "Status pill: inline span (rounded-full px-2 py-0.5 text-[10px], amber-800/ink-100 else) →",
      "  <StatusBadge> (rounded-full px-2.5 py-1 text-[9px]). active→green (emerald), invited→amber,",
      "  any other status (e.g. 'suspended') → gray (bg-bg-gray text-ink-500, was bg-ink-100 text-ink-600).",
      "Create-form inputs/select: 'rounded border px-3 py-2 text-sm' (no ring, not full-width) →",
      "  fieldClass: gains w-full, text-ink-900, and burgundy focus border + ring.",
      "Table: hand-rolled <table> (bg-bg-gray header row, divide-y rows) → <DataTable> primitive",
      "  (overflow-x-auto wrapper, ink-200 border, header text-ink-500 tracking-[0.14em],",
      "  rows hover:bg-bg-gray/40). Same 4 columns, same per-cell 'Beheren →' link, same data.",
    ],
  };
}

/* =================================================================== *
 * PAGE 2 — system/users/page.tsx : local StatusBadge + 9-col table
 * =================================================================== */
function usersList(): Region {
  const userRows = [
    { id: "a1", email: "boss@chefandserve.nl", name: "De Baas", kind: "internal", status: "active", passwordHash: "x", totpEnabled: true, totpEnrolledAt: new Date("2026-01-02") },
    { id: "a2", email: "new@chefandserve.nl", name: null as string | null, kind: "internal", status: "invited", passwordHash: null as string | null, totpEnabled: false, totpEnrolledAt: null as Date | null },
    { id: "a3", email: "chef@extern.nl", name: "Externe Chef", kind: "chef", status: "active", passwordHash: null as string | null, totpEnabled: false, totpEnrolledAt: null as Date | null },
  ];
  const rolesByUser = new Map<string, string[]>([
    ["a1", ["super_admin"]],
    ["a2", ["owner"]],
  ]);
  const STATUS_TONE: Record<string, "green" | "amber"> = { active: "green", invited: "amber" };
  const relativeTime = (d: Date | undefined | null) => (d ? "1 d geleden" : "—");
  const lastSignin = new Map<string, Date>([["a1", new Date()]]);

  const HEADERS = ["E-mail", "Naam", "Type", "Status", "Setup", "2FA", "Rollen", "Laatste login", "Bekijk als"];

  // setup/2FA/impersonate cells are identical fns on both sides
  const emailCell = (u: (typeof userRows)[number]) =>
    h("a", { href: `/admin/system/users/${u.id}`, className: "text-ink-900 hover:text-burgundy hover:underline" }, u.email);
  const setupCell = (u: (typeof userRows)[number]) => {
    const setupDone = u.kind !== "internal" ? null : Boolean(u.passwordHash) && Boolean(u.totpEnabled);
    return u.kind !== "internal"
      ? h("span", { className: "text-ink-500" }, "n.v.t.")
      : setupDone
        ? h("span", { className: "text-emerald-700" }, "✓ klaar")
        : h("span", { className: "text-amber-700" }, "⚠ wacht");
  };
  const twofaCell = (u: (typeof userRows)[number]) =>
    u.kind !== "internal"
      ? h("span", { className: "text-ink-500" }, "n.v.t.")
      : u.totpEnabled
        ? h("span", { className: "text-emerald-700" }, "✓ aan")
        : h("span", { className: "text-ink-500" }, "uit");
  const impersonateCell = (u: (typeof userRows)[number]) =>
    u.status === "active" && !(rolesByUser.get(u.id) ?? []).includes("super_admin")
      ? h(
          "form",
          { method: "POST", action: `/api/impersonate/${u.id}` },
          h("button", { type: "submit", className: "rounded-full border border-burgundy/40 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy hover:bg-burgundy/5" }, "Bekijk als"),
        )
      : h(
          "span",
          { className: "font-ui text-[10px] uppercase tracking-wider text-ink-400" },
          (rolesByUser.get(u.id) ?? []).includes("super_admin") ? "—" : "geen toegang",
        );

  // ----- BEFORE: hand-rolled 9-col table + local StatusBadge ---------------
  const beforeBadge = (status: string) => {
    const tone = status === "active" ? "bg-emerald-100 text-emerald-700" : status === "invited" ? "bg-amber-100 text-amber-700" : "bg-bg-gray text-ink-500";
    return h("span", { className: `rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}` }, status);
  };
  const before = h(
    "div",
    { className: "overflow-x-auto rounded-lg border border-ink-200 bg-white" },
    h(
      "table",
      { className: "w-full min-w-[860px]" },
      h(
        "thead",
        { className: "bg-bg-gray text-left" },
        h("tr", null, ...HEADERS.map((th, i) => h("th", { key: i, className: "px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy" }, th))),
      ),
      h(
        "tbody",
        null,
        ...userRows.map((u, i) =>
          h(
            "tr",
            { key: u.id, className: i < userRows.length - 1 ? "border-b border-ink-200" : "" },
            h("td", { className: "px-4 py-3 text-sm" }, emailCell(u)),
            h("td", { className: "px-4 py-3 text-sm text-ink-700" }, u.name ?? "—"),
            h("td", { className: "px-4 py-3 text-xs text-ink-500" }, u.kind),
            h("td", { className: "px-4 py-3" }, beforeBadge(u.status)),
            h("td", { className: "px-4 py-3 text-xs" }, setupCell(u)),
            h("td", { className: "px-4 py-3 text-xs" }, twofaCell(u)),
            h("td", { className: "px-4 py-3 text-xs text-ink-700" }, (rolesByUser.get(u.id) ?? []).join(", ") || "—"),
            h("td", { className: "px-4 py-3 text-xs text-ink-500" }, relativeTime(lastSignin.get(u.id))),
            h("td", { className: "px-4 py-3" }, impersonateCell(u)),
          ),
        ),
      ),
    ),
  );

  // ----- AFTER: real DataTable + real StatusBadge --------------------------
  type Row = (typeof userRows)[number];
  const after = h(DataTable<Row>, {
    rows: userRows,
    getRowKey: (u: Row) => u.id,
    columns: [
      { key: "email", header: "E-mail", cell: emailCell },
      { key: "name", header: "Naam", cell: (u: Row) => u.name ?? "—" },
      { key: "type", header: "Type", cell: (u: Row) => u.kind },
      { key: "status", header: "Status", cell: (u: Row) => h(StatusBadge, { tone: STATUS_TONE[u.status] ?? "gray", label: u.status }) },
      { key: "setup", header: "Setup", cell: setupCell },
      { key: "twofa", header: "2FA", cell: twofaCell },
      { key: "roles", header: "Rollen", cell: (u: Row) => (rolesByUser.get(u.id) ?? []).join(", ") || "—" },
      { key: "lastLogin", header: "Laatste login", cell: (u: Row) => relativeTime(lastSignin.get(u.id)) },
      { key: "impersonate", header: "Bekijk als", cell: impersonateCell },
    ],
  });

  return {
    page: "users-list",
    before,
    after,
    mustSurvive: [
      "boss@chefandserve.nl", "De Baas", "new@chefandserve.nl", "chef@extern.nl", "Externe Chef",
      "active", "invited", "internal", "chef",
      "/admin/system/users/a1", "/admin/system/users/a2", "/admin/system/users/a3",
      // a1 super_admin → '—' span; a2 invited → 'geen toegang' span; a3 active non-super-admin → POST form
      "/api/impersonate/a3",
      "✓ klaar", "⚠ wacht", "✓ aan", "n.v.t.", "geen toegang", "Bekijk als",
      ...HEADERS,
    ],
    delta: [
      "Local StatusBadge component (rounded-full px-2.5 py-1 text-[9px], invited→amber-700) →",
      "  shared <StatusBadge>: same geometry; invited→amber-800 (canonical), any non-active/invited → gray.",
      "Table: hand-rolled <table min-w-[860px]> (bg-bg-gray header, header text-burgundy tracking-[0.2em],",
      "  manual border-b rows) → <DataTable> primitive (overflow-x-auto, NO fixed min-w-[860px];",
      "  header text-ink-500 tracking-[0.14em]; rows hover:bg-bg-gray/40 last:border-0).",
      "All 9 columns preserved in order. E-mail per-cell link, 'Bekijk als' POST form / disabled span,",
      "  setup/2FA emerald-amber micro-indicators, relative-time — all rendered IDENTICALLY.",
      "Note: outer <td> text color/size normalizes to DataTable default (text-sm text-ink-900); the inner",
      "  colored status spans (✓ klaar etc.) are unchanged content.",
    ],
  };
}

/* =================================================================== *
 * PAGE 3 — system/roles/page.tsx : create-form inputs (TASK B only)
 * =================================================================== */
function rolesForm(): Region {
  const mkBefore = (name: string, ph: string) =>
    h("input", { name, placeholder: ph, className: "rounded border border-ink-200 px-3 py-2 text-sm" });
  const before = h(
    "form",
    { className: "mt-4 grid gap-3 sm:grid-cols-3" },
    mkBefore("key", "key (bv. senior_planner)"),
    mkBefore("label", "Label"),
    mkBefore("description", "Omschrijving"),
  );
  const mkAfter = (name: string, ph: string) => h("input", { name, placeholder: ph, className: fieldClass });
  const after = h(
    "form",
    { className: "mt-4 grid gap-3 sm:grid-cols-3" },
    mkAfter("key", "key (bv. senior_planner)"),
    mkAfter("label", "Label"),
    mkAfter("description", "Omschrijving"),
  );
  return {
    page: "roles-form",
    before,
    after,
    mustSurvive: ["key (bv. senior_planner)", "Label", "Omschrijving"],
    delta: [
      "Create-role inputs (key/label/description): 'rounded border px-3 py-2 text-sm' (no ring, not full-width)",
      "  → fieldClass: gains w-full, text-ink-900, burgundy focus border + ring. Placeholders unchanged.",
      "NOT TOUCHED on this page: the '{n} perms' count chip (a count, not a status) and the permission",
      "  checkboxes (h-3.5 w-3.5) stay as-is.",
    ],
  };
}

/* =================================================================== *
 * PAGE 4 — system/users/new/page.tsx : 2 inputs + role select (TASK B)
 * =================================================================== */
function newUserForm(): Region {
  const BEFORE_INPUT = "w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
  const before = h(
    "form",
    { className: "space-y-5" },
    h("input", { type: "text", name: "name", placeholder: "bijv. Maarten Hogeveen", className: BEFORE_INPUT }),
    h("input", { type: "email", name: "email", placeholder: "bijv. maarten@chefandserve.nl", className: BEFORE_INPUT }),
    h(
      "select",
      { name: "role", defaultValue: "", className: "w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy" },
      h("option", { value: "", disabled: true }, "Kies een rol…"),
      h("option", { value: "owner" }, "Owner — operations toegang"),
      h("option", { value: "super_admin" }, "Super_admin — volledige toegang inclusief systeem-pagina's"),
    ),
  );
  const after = h(
    "form",
    { className: "space-y-5" },
    h("input", { type: "text", name: "name", placeholder: "bijv. Maarten Hogeveen", className: fieldClass }),
    h("input", { type: "email", name: "email", placeholder: "bijv. maarten@chefandserve.nl", className: fieldClass }),
    h(
      "select",
      { name: "role", defaultValue: "", className: fieldClass },
      h("option", { value: "", disabled: true }, "Kies een rol…"),
      h("option", { value: "owner" }, "Owner — operations toegang"),
      h("option", { value: "super_admin" }, "Super_admin — volledige toegang inclusief systeem-pagina's"),
    ),
  );
  return {
    page: "users-new-form",
    before,
    after,
    mustSurvive: [
      "bijv. Maarten Hogeveen", "bijv. maarten@chefandserve.nl",
      "Kies een rol…", "Owner — operations toegang", "Super_admin — volledige toegang inclusief systeem-pagina's",
    ],
    delta: [
      "Name input, email input, role <select>: 'px-4 py-3 text-base placeholder-ink-500' (large fields)",
      "  → fieldClass: 'px-3 py-2 text-sm' (smaller canonical geometry), drops explicit placeholder-ink-500",
      "  (relies on browser default). Same w-full + burgundy focus ring. All options + Dutch labels unchanged.",
    ],
  };
}

/* =================================================================== *
 * PAGE 5+6 — team/[id] + users/[id] : effect <select> (+ confirm input)
 * =================================================================== */
function overrideControls(): Region {
  // the effect <select> in a justify-between permission row (both [id] pages)
  const beforeSelect = h(
    "div",
    { className: "flex items-center justify-between gap-3 py-2" },
    h("span", { className: "text-sm text-ink-800" }, "Klanten bewerken ", h("span", { className: "font-mono text-[10px] text-ink-400" }, "clients.write")),
    h(
      "select",
      { name: "effect_clients.write", defaultValue: "inherit", className: "rounded border border-ink-200 px-2 py-1 text-xs text-ink-800" },
      h("option", { value: "inherit" }, "Standaard (rol)"),
      h("option", { value: "grant" }, "Toekennen"),
      h("option", { value: "revoke" }, "Intrekken"),
    ),
  );
  const afterSelect = h(
    "div",
    { className: "flex items-center justify-between gap-3 py-2" },
    h("span", { className: "text-sm text-ink-800" }, "Klanten bewerken ", h("span", { className: "font-mono text-[10px] text-ink-400" }, "clients.write")),
    h(
      "select",
      { name: "effect_clients.write", defaultValue: "inherit", className: `${fieldClass} !w-auto` },
      h("option", { value: "inherit" }, "Standaard (rol)"),
      h("option", { value: "grant" }, "Toekennen"),
      h("option", { value: "revoke" }, "Intrekken"),
    ),
  );
  // the font-mono confirm-email input on users/[id]
  const beforeConfirm = h("input", {
    type: "email", name: "confirmationEmail", placeholder: "boss@chefandserve.nl",
    className: "w-full max-w-md rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy",
  });
  const afterConfirm = h("input", {
    type: "email", name: "confirmationEmail", placeholder: "boss@chefandserve.nl",
    className: `${fieldClass} max-w-md font-mono`,
  });

  const before = h(React.Fragment, null, beforeConfirm, beforeSelect);
  const after = h(React.Fragment, null, afterConfirm, afterSelect);
  return {
    page: "override-controls",
    before,
    after,
    mustSurvive: [
      "Klanten bewerken", "clients.write", "Standaard (rol)", "Toekennen", "Intrekken",
      "boss@chefandserve.nl", "effect_clients.write", "confirmationEmail",
    ],
    delta: [
      "Per-permission effect <select> (both [id] pages): 'rounded border px-2 py-1 text-xs' (compact) →",
      "  `${fieldClass} !w-auto`: canonical border + burgundy ring + px-3 py-2 text-sm; !w-auto keeps it",
      "  content-width so the justify-between row layout is preserved (fieldClass's w-full would stretch it).",
      "Confirm-email input (users/[id], 2FA reset): bespoke px-3 py-2 font-mono → `${fieldClass} max-w-md",
      "  font-mono` — keeps font-mono (per exception) + max-w-md width cap; gains canonical text/ring tokens.",
      "NOT TOUCHED on these pages: role checkboxes (h-4 w-4) and the 'actief' inline capability tag",
      "  (rounded px-1.5 py-0.5 text-[9px] emerald) — an effective-state annotation in a dense perm list,",
      "  not the canonical row-status pill, so left as-is to avoid distorting the list.",
    ],
  };
}

/* =================================================================== *
 * Run all regions
 * =================================================================== */
const regions: Region[] = [teamList(), usersList(), rolesForm(), newUserForm(), overrideControls()];

let allOk = true;
for (const r of regions) {
  const beforeHtml = renderToStaticMarkup(r.before as React.ReactElement);
  const afterHtml = renderToStaticMarkup(r.after as React.ReactElement);
  writeFileSync(join(HARNESS, `${r.page}-before.html`), wrap(`${r.page} — BEFORE`, beforeHtml));
  writeFileSync(join(HARNESS, `${r.page}-after.html`), wrap(`${r.page} — AFTER`, afterHtml));

  console.log(`\n${"=".repeat(72)}\n${r.page}`);
  console.log(`  wrote _harness/${r.page}-before.html  +  _harness/${r.page}-after.html`);

  // data/href preservation assertion: every mustSurvive string must appear in
  // BOTH before and after (proves nothing was dropped by the normalization).
  // Compare against entity-decoded HTML so raw apostrophes/ampersands match.
  const beforeText = decodeEntities(beforeHtml);
  const afterText = decodeEntities(afterHtml);
  const missingBefore = r.mustSurvive.filter((s) => !beforeText.includes(s));
  const missingAfter = r.mustSurvive.filter((s) => !afterText.includes(s));
  if (missingBefore.length) {
    allOk = false;
    console.log(`  ✗ BASELINE BUG — strings expected but absent from BEFORE: ${JSON.stringify(missingBefore)}`);
  }
  if (missingAfter.length) {
    allOk = false;
    console.log(`  ✗ DATA/LINK DROPPED — present in BEFORE, missing from AFTER: ${JSON.stringify(missingAfter)}`);
  }
  if (!missingBefore.length && !missingAfter.length) {
    console.log(`  ✓ all ${r.mustSurvive.length} data values + hrefs preserved BEFORE → AFTER`);
  }

  console.log(`  visual delta:`);
  for (const line of r.delta) console.log(`    ${line.startsWith("  ") ? "" : "• "}${line}`);
}

console.log(`\n${"=".repeat(72)}`);
console.log(allOk ? "RESULT: ✓ every region preserves all data + links (intentional visual normalization only)" : "RESULT: ✗ a region dropped data/links — see above");
if (!allOk) process.exit(1);
