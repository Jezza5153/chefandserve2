import Link from "next/link";

import { hasRole } from "@/lib/permissions";

import type { Session } from "next-auth";

/**
 * Role-aware sidebar nav.
 *
 * Layout:
 *   - super_admin: System + Operations sections
 *   - owner:       Operations section only
 *
 * "Binnenkort" items render as disabled rows with a burgundy pill —
 * keeps the future shape visible without dead links.
 */

type NavItem = {
  label: string;
  href?: string;
  badge?: "binnenkort";
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SYSTEM_NAV: NavSection = {
  label: "System",
  items: [
    { label: "Dashboard", href: "/admin/system" },
    { label: "Errors", href: "/admin/system/errors" },
    { label: "Audit", href: "/admin/system/audit" },
    { label: "Webhooks", href: "/admin/system/webhooks" },
    { label: "Emails", href: "/admin/system/emails" },
    { label: "Notificaties", href: "/admin/system/notifications" },
    { label: "Integraties", href: "/admin/business/integrations" },
    { label: "Health", href: "/admin/system/health" },
    { label: "Users", href: "/admin/system/users" },
    { label: "Roles", href: "/admin/system/roles" },
  ],
};

const OPS_NAV: NavSection = {
  label: "Operations",
  items: [
    { label: "Dashboard", href: "/admin/business" },
    { label: "Inbox", href: "/admin/business/inbox" },
    { label: "Chefs", href: "/admin/business/chefs" },
    { label: "Clients", href: "/admin/business/clients" },
    { label: "Shifts", href: "/admin/business/shifts" },
    { label: "Uren keuren", href: "/admin/business/hours" },
    { label: "Payroll", href: "/admin/business/payroll" },
    { label: "Roster", badge: "binnenkort" },
  ],
};

const ACCOUNT_NAV: NavSection = {
  label: "Mijn account",
  items: [{ label: "2FA", href: "/admin/account/2fa" }],
};

export function SidebarNav({ session }: { session: Session }) {
  const isSuperAdmin = hasRole(session, "super_admin");

  return (
    <nav className="flex-1 px-3 py-6" aria-label="Admin navigation">
      {isSuperAdmin && <NavGroup section={SYSTEM_NAV} />}
      <NavGroup
        section={OPS_NAV}
        className={isSuperAdmin ? "mt-8" : ""}
      />
      <NavGroup section={ACCOUNT_NAV} className="mt-8" />
    </nav>
  );
}

function NavGroup({
  section,
  className = "",
}: {
  section: NavSection;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="px-3 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {section.label}
      </p>
      <ul className="mt-2 space-y-1">
        {section.items.map((item) =>
          item.href ? (
            <li key={item.label}>
              <Link
                href={item.href}
                className="block rounded px-3 py-2 font-ui text-sm text-ink-900 hover:bg-burgundy/5 hover:text-burgundy"
              >
                {item.label}
              </Link>
            </li>
          ) : (
            <li
              key={item.label}
              className="flex items-center justify-between rounded px-3 py-2 font-ui text-sm text-ink-500"
            >
              <span>{item.label}</span>
              {item.badge === "binnenkort" && (
                <span className="rounded-full bg-burgundy/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-burgundy">
                  Binnenkort
                </span>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
