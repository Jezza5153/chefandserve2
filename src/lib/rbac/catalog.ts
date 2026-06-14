/**
 * RBAC catalog (PR-RBAC-1) — the single source of truth for:
 *   - the permission catalog (every `resource.action` + its class),
 *   - the system-vs-business classification (a code constant, NEVER a DB toggle,
 *     so an owner can't reclassify a system perm and grant themselves access),
 *   - the role → permission grants engineered to mirror TODAY's role-name access
 *     EXACTLY (so flipping the gates is behavior-neutral until an admin edits),
 *   - the gate → permission map used by both the gate-flip and the parity audit.
 *
 * DESIGN INVARIANT (proven by scripts/audit-permission-parity.ts): for every
 * entry in GATE_MAP, the set of roles that satisfied the OLD role-name gate
 * equals the set of roles whose grants include the mapped permission
 * (super_admin always holds every permission). Do not edit ROLE_GRANTS or
 * GATE_MAP without re-running the parity script.
 *
 * Pure data — no DB / Next.js imports — so it is importable by the seed script
 * (tsx), the runtime guards, and the parity audit alike.
 */

export type PermClass = "system" | "business";

export type CatalogPerm = {
  /** "resource.action" */
  key: string;
  resource: string;
  action: string;
  class: PermClass;
  /** Dutch admin-facing label (used by the role/override editors). */
  label: string;
};

/* ------------------------------------------------------------------ *
 * The catalog. SYSTEM perms are super_admin-only IT/platform surfaces;
 * BUSINESS perms are operational surfaces owners (± planners) work in.
 * ------------------------------------------------------------------ */
export const CATALOG: CatalogPerm[] = [
  /* ===== SYSTEM (super_admin only) ===== */
  { key: "system.read", resource: "system", action: "read", class: "system", label: "Systeemdashboard bekijken" },
  // Deliberately granted to NO role by default — only super_admin holds it via the bypass.
  { key: "system.write", resource: "system", action: "write", class: "system", label: "Systeemconfiguratie beheren (inboxen e.d.)" },
  { key: "users.read", resource: "users", action: "read", class: "system", label: "Gebruikers bekijken" },
  { key: "users.write", resource: "users", action: "write", class: "system", label: "Gebruikers bewerken" },
  { key: "users.invite", resource: "users", action: "invite", class: "system", label: "Gebruikers uitnodigen" },
  { key: "users.disable", resource: "users", action: "disable", class: "system", label: "Gebruikers uitschakelen" },
  { key: "roles.read", resource: "roles", action: "read", class: "system", label: "Rollen bekijken" },
  { key: "roles.write", resource: "roles", action: "write", class: "system", label: "Rollen & rechten beheren" },
  { key: "audit.read", resource: "audit", action: "read", class: "system", label: "Audit-log bekijken" },
  { key: "errors.read", resource: "errors", action: "read", class: "system", label: "Foutmeldingen bekijken" },
  { key: "errors.resolve", resource: "errors", action: "resolve", class: "system", label: "Foutmeldingen oplossen" },
  { key: "webhooks.read", resource: "webhooks", action: "read", class: "system", label: "Webhooks bekijken" },
  { key: "webhooks.replay", resource: "webhooks", action: "replay", class: "system", label: "Webhooks opnieuw verwerken" },
  { key: "emails.read", resource: "emails", action: "read", class: "system", label: "E-mailbezorging bekijken" },
  { key: "notifications.routes", resource: "notifications", action: "routes", class: "system", label: "Notificatie-routering beheren" },
  { key: "privacy.read", resource: "privacy", action: "read", class: "system", label: "Privacyverzoeken bekijken" },
  { key: "privacy.process", resource: "privacy", action: "process", class: "system", label: "Privacyverzoeken afhandelen" },
  { key: "privacy.export", resource: "privacy", action: "export", class: "system", label: "Privacy-data exporteren" },
  { key: "retention.read", resource: "retention", action: "read", class: "system", label: "Retentiebeleid bekijken" },
  { key: "retention.run", resource: "retention", action: "run", class: "system", label: "Retentie-opschoning draaien" },
  { key: "integrations.read", resource: "integrations", action: "read", class: "system", label: "Integraties & outbox bekijken" },
  { key: "integrations.write", resource: "integrations", action: "write", class: "system", label: "Integraties beheren" },
  { key: "health.read", resource: "health", action: "read", class: "system", label: "Systeemgezondheid bekijken" },
  { key: "impersonation.use", resource: "impersonation", action: "use", class: "system", label: "Bekijken-als gebruiken" },

  /* ===== BUSINESS — owner-class (owner + super_admin; NOT planner) ===== */
  { key: "cockpit.read", resource: "cockpit", action: "read", class: "business", label: "Cockpit (bedrijfsoverzicht) bekijken" },
  { key: "assistant.use", resource: "assistant", action: "use", class: "business", label: "AI-assistent gebruiken" },
  { key: "clients.read", resource: "clients", action: "read", class: "business", label: "Klanten bekijken" },
  { key: "clients.write", resource: "clients", action: "write", class: "business", label: "Klanten bewerken" },
  { key: "hours.read", resource: "hours", action: "read", class: "business", label: "Uren bekijken" },
  { key: "hours.approve", resource: "hours", action: "approve", class: "business", label: "Uren goed-/afkeuren" },
  { key: "payroll.read", resource: "payroll", action: "read", class: "business", label: "Payroll bekijken" },
  { key: "payroll.export", resource: "payroll", action: "export", class: "business", label: "Payroll exporteren" },
  { key: "invoices.read", resource: "invoices", action: "read", class: "business", label: "Facturen bekijken" },
  { key: "account.settings", resource: "account", action: "settings", class: "business", label: "Persoonlijke instellingen" },
  { key: "settings.write", resource: "settings", action: "write", class: "business", label: "Bedrijfsinstellingen beheren" },
  { key: "notifications.read", resource: "notifications", action: "read", class: "business", label: "Eigen notificaties bekijken" },
  { key: "team.read", resource: "team", action: "read", class: "business", label: "Team bekijken" },
  { key: "team.manage", resource: "team", action: "manage", class: "business", label: "Team & rechten beheren" },

  /* ===== BUSINESS — owner+planner-class (owner + planner + super_admin) ===== */
  { key: "chefs.read", resource: "chefs", action: "read", class: "business", label: "Chefs bekijken" },
  { key: "chefs.write", resource: "chefs", action: "write", class: "business", label: "Chefs bewerken" },
  { key: "shifts.read", resource: "shifts", action: "read", class: "business", label: "Shifts bekijken" },
  { key: "shifts.write", resource: "shifts", action: "write", class: "business", label: "Shifts plannen/bewerken" },
  { key: "roster.read", resource: "roster", action: "read", class: "business", label: "Rooster bekijken" },
  { key: "planning.read", resource: "planning", action: "read", class: "business", label: "Planning-werkruimte bekijken" },
  { key: "templates.read", resource: "templates", action: "read", class: "business", label: "Shift-sjablonen bekijken" },
  { key: "templates.write", resource: "templates", action: "write", class: "business", label: "Shift-sjablonen beheren" },
  { key: "forms.read", resource: "forms", action: "read", class: "business", label: "Formulieren bekijken" },
  { key: "forms.write", resource: "forms", action: "write", class: "business", label: "Formulieren bouwen" },
  { key: "reminders.read", resource: "reminders", action: "read", class: "business", label: "Herinneringen bekijken" },
  { key: "reminders.write", resource: "reminders", action: "write", class: "business", label: "Herinneringen beheren" },
  { key: "board.read", resource: "board", action: "read", class: "business", label: "Prikbord bekijken" },
  { key: "board.write", resource: "board", action: "write", class: "business", label: "Prikbord beheren" },
  { key: "inbox.read", resource: "inbox", action: "read", class: "business", label: "Inbox bekijken" },
  { key: "inbox.triage", resource: "inbox", action: "triage", class: "business", label: "Inbox triageren (omzetten/afwijzen)" },
];

/* ------------------------------------------------------------------ *
 * Classification helpers (the security wall — code constants).
 * ------------------------------------------------------------------ */
export const SYSTEM_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  CATALOG.filter((p) => p.class === "system").map((p) => p.key),
);
export const BUSINESS_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  CATALOG.filter((p) => p.class === "business").map((p) => p.key),
);
/** The only role that holds system permissions. Owners are confined to business. */
export const SYSTEM_ROLE_KEYS: ReadonlySet<string> = new Set(["super_admin"]);

export function isSystemPermission(key: string): boolean {
  return SYSTEM_PERMISSION_KEYS.has(key);
}
export function permKeyExists(key: string): boolean {
  return CATALOG.some((p) => p.key === key);
}

/* ------------------------------------------------------------------ *
 * Role → granted permission keys. Engineered to reproduce TODAY's
 * role-name access exactly (see GATE_MAP + the parity audit).
 *
 * NOTE: planner is intentionally tighter than the legacy Phase-0 seed —
 * the legacy seed granted planner clients.read/hours.read/dashboard.read,
 * but every clients/hours/cockpit PAGE gates on requireRole("owner"), so
 * planner was denied in practice. We grant planner only the owner+planner
 * surfaces, matching real behavior.
 * ------------------------------------------------------------------ */
const OWNER_PLANNER_PERMS = [
  "chefs.read", "chefs.write",
  "shifts.read", "shifts.write",
  "roster.read", "planning.read",
  "templates.read", "templates.write",
  "forms.read", "forms.write",
  "reminders.read", "reminders.write",
  "inbox.read", "inbox.triage",
  "board.read", "board.write",
];

const OWNER_ONLY_PERMS = [
  "cockpit.read",
  "assistant.use",
  "clients.read", "clients.write",
  "hours.read", "hours.approve",
  "payroll.read", "payroll.export",
  "invoices.read",
  "account.settings", "settings.write",
  "notifications.read",
  "team.read", "team.manage",
];

export const ROLE_GRANTS: Record<string, string[]> = {
  super_admin: CATALOG.map((p) => p.key), // all
  owner: [...OWNER_ONLY_PERMS, ...OWNER_PLANNER_PERMS],
  planner: [...OWNER_PLANNER_PERMS],
};

/* ------------------------------------------------------------------ *
 * Gate → permission map. `oldGate` records the pre-flip role-name gate
 * so the parity audit can prove the flip changes nothing. The flip
 * (requirePermission) and the audit both read this.
 *
 * `routes` is documentation (which files share this gate). One entry per
 * (access-class, permission) pairing; many files map to the same entry.
 * ------------------------------------------------------------------ */
export type AccessClass = "owner" | "owner_planner" | "super_admin";

export type GateMapping = {
  /** stable id, used in audit output */
  id: string;
  oldGate: AccessClass;
  perm: string;
  /** representative routes (docs only) */
  routes: string[];
};

export const GATE_MAP: GateMapping[] = [
  /* ---- owner+planner class ---- */
  { id: "chefs.list", oldGate: "owner_planner", perm: "chefs.read", routes: ["/admin/business/chefs"] },
  { id: "chefs.detail", oldGate: "owner_planner", perm: "chefs.write", routes: ["/admin/business/chefs/[id]"] },
  { id: "shifts.list", oldGate: "owner_planner", perm: "shifts.read", routes: ["/admin/business/shifts"] },
  { id: "shifts.detail", oldGate: "owner_planner", perm: "shifts.write", routes: ["/admin/business/shifts/[id]", "/admin/business/shifts/new"] },
  { id: "roster", oldGate: "owner_planner", perm: "roster.read", routes: ["/admin/business/roster"] },
  { id: "planning", oldGate: "owner_planner", perm: "planning.read", routes: ["/admin/planning"] },
  { id: "templates", oldGate: "owner_planner", perm: "templates.write", routes: ["/admin/business/templates", "/admin/business/templates/[id]", "/admin/business/templates/new"] },
  { id: "forms", oldGate: "owner_planner", perm: "forms.write", routes: ["/admin/business/forms", "/admin/business/forms/[slug]"] },
  { id: "reminders", oldGate: "owner_planner", perm: "reminders.write", routes: ["/admin/business/reminders"] },
  { id: "board", oldGate: "owner_planner", perm: "board.write", routes: ["/admin/business/board"] },
  { id: "inbox", oldGate: "owner_planner", perm: "inbox.triage", routes: ["/admin/business/inbox", "/admin/business/inbox/[kind]/[id]"] },

  /* ---- owner-only class ---- */
  { id: "cockpit", oldGate: "owner", perm: "cockpit.read", routes: ["/admin/business"] },
  { id: "assistant", oldGate: "owner", perm: "assistant.use", routes: ["/admin/assistant"] },
  { id: "reporting", oldGate: "owner", perm: "cockpit.read", routes: ["/admin/business/reporting"] },
  { id: "clients", oldGate: "owner", perm: "clients.write", routes: ["/admin/business/clients", "/admin/business/clients/[id]"] },
  { id: "hours.list", oldGate: "owner", perm: "hours.read", routes: ["/admin/business/hours"] },
  { id: "hours.approve", oldGate: "owner", perm: "hours.approve", routes: ["/admin/business/hours/[id]"] },
  { id: "payroll", oldGate: "owner", perm: "payroll.read", routes: ["/admin/business/payroll"] },
  { id: "payroll.export", oldGate: "owner", perm: "payroll.export", routes: ["/admin/business/payroll/[id]/export.csv"] },
  { id: "invoices", oldGate: "owner", perm: "invoices.read", routes: ["/admin/business/invoices", "/admin/business/invoices/[id]", "/admin/business/invoices/export.csv"] },
  { id: "account.settings", oldGate: "owner", perm: "account.settings", routes: ["/admin/account/instellingen", "/admin/account/2fa"] },
  { id: "business.settings", oldGate: "owner", perm: "settings.write", routes: ["/admin/business/instellingen"] },
  { id: "notifications.center", oldGate: "owner", perm: "notifications.read", routes: ["/admin/notifications"] },
  { id: "team.list", oldGate: "owner", perm: "team.read", routes: ["/admin/business/team"] },
  { id: "team.detail", oldGate: "owner", perm: "team.manage", routes: ["/admin/business/team/[id]", "/admin/business/team/new"] },

  /* ---- super_admin class (system) ---- */
  { id: "system.home", oldGate: "super_admin", perm: "system.read", routes: ["/admin/system"] },
  { id: "errors", oldGate: "super_admin", perm: "errors.read", routes: ["/admin/system/errors"] },
  { id: "audit", oldGate: "super_admin", perm: "audit.read", routes: ["/admin/system/audit"] },
  { id: "health", oldGate: "super_admin", perm: "health.read", routes: ["/admin/system/health"] },
  { id: "emails", oldGate: "super_admin", perm: "emails.read", routes: ["/admin/system/emails", "/api/admin/emails/[template]"] },
  { id: "notifications.routes", oldGate: "super_admin", perm: "notifications.routes", routes: ["/admin/system/notifications"] },
  { id: "webhooks", oldGate: "super_admin", perm: "webhooks.read", routes: ["/admin/system/webhooks", "/admin/system/webhooks/[id]"] },
  { id: "privacy", oldGate: "super_admin", perm: "privacy.read", routes: ["/admin/system/privacy-requests", "/admin/system/privacy-requests/[id]", "/admin/system/privacy-requests/new"] },
  { id: "retention", oldGate: "super_admin", perm: "retention.read", routes: ["/admin/system/retention"] },
  { id: "users", oldGate: "super_admin", perm: "users.read", routes: ["/admin/system/users", "/admin/system/users/[id]", "/admin/system/users/new"] },
  { id: "roles", oldGate: "super_admin", perm: "roles.read", routes: ["/admin/system/roles"] },
  { id: "integrations", oldGate: "super_admin", perm: "integrations.read", routes: ["/admin/business/integrations", "/admin/business/integrations/outbox"] },
];

/** Roles that satisfy a given old role-name gate (super_admin bypasses requireRole). */
export function rolesSatisfyingOldGate(gate: AccessClass): Set<string> {
  switch (gate) {
    case "owner":
      return new Set(["owner", "super_admin"]);
    case "owner_planner":
      return new Set(["owner", "planner", "super_admin"]);
    case "super_admin":
      return new Set(["super_admin"]);
  }
}

/** Roles whose ROLE_GRANTS include a permission (super_admin holds all). */
export function rolesWithPermission(perm: string): Set<string> {
  const out = new Set<string>();
  for (const [role, perms] of Object.entries(ROLE_GRANTS)) {
    if (perms.includes(perm)) out.add(role);
  }
  return out;
}

/**
 * Longest-prefix GATE_MAP permission for a route — the most specific mapped
 * route that is a prefix of `route`. The C3 codemod + the parity audit both
 * use this so a page maps to the same perm in both places.
 */
export function permForRoute(route: string): string | null {
  let best: { g: string; perm: string } | null = null;
  for (const entry of GATE_MAP) {
    for (const g of entry.routes) {
      if (route === g || route.startsWith(g + "/")) {
        if (!best || g.length > best.g.length) best = { g, perm: entry.perm };
      }
    }
  }
  return best?.perm ?? null;
}
