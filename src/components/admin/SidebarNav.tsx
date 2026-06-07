"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/admin/icons";

/**
 * Role-aware cockpit nav (V3 look): icon rows, active highlight, optional badge.
 * Takes `roles` (not the session object) so it stays a clean client component.
 *
 * "Binnenkort" items render disabled — keeps the future shape visible, no dead
 * links. Ambiguous V3 labels map to the nearest real route:
 *   Planning → /shifts · Uren & loon → /hours (payroll via Exporteren/footer).
 * Analyse → /admin/business/insights (KPI-4 ranglijsten). Templates/Payroll stay
 * reachable from the dashboard toolbar; super-admins keep the full Systeem group.
 */

type Item = { label: string; href?: string; icon: IconName; soon?: boolean };

const MAIN: Item[] = [
  { label: "Cockpit", href: "/admin/business", icon: "dashboard" },
  { label: "Assistent", href: "/admin/assistant", icon: "message" },
  { label: "Rooster", href: "/admin/business/roster", icon: "calendar-days" },
  { label: "Planning", href: "/admin/business/shifts", icon: "list" },
  { label: "Chefs", href: "/admin/business/chefs", icon: "users" },
  { label: "Klanten", href: "/admin/business/clients", icon: "building" },
  { label: "Inbox", href: "/admin/business/inbox", icon: "inbox" },
  { label: "Formulieren", href: "/admin/business/forms", icon: "message" },
  { label: "Herinneringen", href: "/admin/business/reminders", icon: "bell" },
  { label: "Uren & loon", href: "/admin/business/hours", icon: "wallet" },
  { label: "Analyse", href: "/admin/business/insights", icon: "bar-chart" },
  { label: "Team", href: "/admin/business/team", icon: "user-round" },
  { label: "Instellingen", href: "/admin/account/instellingen", icon: "settings" },
  { label: "Bedrijf", href: "/admin/business/instellingen", icon: "settings" },
];

/**
 * Planner-only nav (planner AND NOT owner). Cockpit / Klanten / Uren & loon / Analyse
 * are owner-only and intentionally hidden. "Planning" is the planner cockpit
 * (/admin/planning); the owner's "Planning" (shifts) becomes "Diensten" here.
 */
const PLANNER_MAIN: Item[] = [
  { label: "Planning", href: "/admin/planning", icon: "dashboard" },
  { label: "Inbox", href: "/admin/business/inbox", icon: "inbox" },
  { label: "Formulieren", href: "/admin/business/forms", icon: "message" },
  { label: "Rooster", href: "/admin/business/roster", icon: "calendar-days" },
  { label: "Diensten", href: "/admin/business/shifts", icon: "list" },
  { label: "Chefs", href: "/admin/business/chefs", icon: "users" },
  { label: "Herinneringen", href: "/admin/business/reminders", icon: "bell" },
  { label: "Instellingen", href: "/admin/account/instellingen", icon: "settings" },
];

const SYSTEM: Item[] = [
  { label: "Systeem", href: "/admin/system", icon: "dashboard" },
  { label: "Errors", href: "/admin/system/errors", icon: "alert-triangle" },
  { label: "Audit", href: "/admin/system/audit", icon: "list" },
  { label: "Webhooks", href: "/admin/system/webhooks", icon: "arrow-right" },
  { label: "Emails", href: "/admin/system/emails", icon: "message" },
  { label: "Notificaties", href: "/admin/system/notifications", icon: "bell" },
  { label: "Privacyverzoeken", href: "/admin/system/privacy-requests", icon: "shield-check" },
  { label: "Retentie", href: "/admin/system/retention", icon: "clock" },
  { label: "Integraties", href: "/admin/business/integrations", icon: "settings" },
  { label: "Health", href: "/admin/system/health", icon: "check-circle" },
  { label: "Users", href: "/admin/system/users", icon: "users" },
  { label: "Roles", href: "/admin/system/roles", icon: "user-round" },
];

/** Exact for the two section "home" hrefs, prefix-match for everything else. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin/business" || href === "/admin/system") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav({ roles }: { roles: string[] }) {
  const pathname = usePathname() ?? "";
  const isSuperAdmin = roles.includes("super_admin");
  // Planner-AND-NOT-owner gets the trimmed planner nav; owner / owner+planner /
  // super_admin keep the full MAIN (owner cockpit stays byte-for-byte unchanged).
  const isPlannerOnly = roles.includes("planner") && !roles.includes("owner") && !isSuperAdmin;
  const main = isPlannerOnly ? PLANNER_MAIN : MAIN;

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Admin navigatie">
      <ul className="space-y-0.5">
        {main.map((item) => (
          <NavRow key={item.label} item={item} active={!!item.href && isActive(pathname, item.href)} />
        ))}
      </ul>
      {isSuperAdmin && (
        <div>
          <p className="px-3 pb-1 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">Systeem</p>
          <ul className="space-y-0.5">
            {SYSTEM.map((item) => (
              <NavRow key={item.label} item={item} active={!!item.href && isActive(pathname, item.href)} />
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

function NavRow({ item, active }: { item: Item; active: boolean }) {
  if (!item.href) {
    return (
      <li className="flex items-center justify-between rounded-lg px-3 py-2.5 font-ui text-[13px] text-ink-500">
        <span className="flex items-center gap-3">
          <Icon name={item.icon} className="h-[18px] w-[18px]" />
          {item.label}
        </span>
        {item.soon && (
          <span className="rounded-full bg-burgundy/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-burgundy">
            Binnenkort
          </span>
        )}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-ui text-[13px] ${
          active
            ? "bg-burgundy font-medium text-white"
            : "text-ink-700 hover:bg-bg-gray hover:text-burgundy"
        }`}
      >
        <Icon name={item.icon} className="h-[18px] w-[18px]" />
        {item.label}
      </Link>
    </li>
  );
}
