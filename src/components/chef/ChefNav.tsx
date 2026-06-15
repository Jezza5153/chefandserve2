"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Icon, type IconName } from "@/components/admin/icons";

/**
 * Chef portal nav — phone-first. Chefs view this on their phone, so:
 *   - `< md`: a sticky bottom tab bar (4 primary tabs + "Meer" sheet), ≥44px
 *     tap targets, safe-area padded.
 *   - `md+`: the familiar top pill row (all destinations).
 * One client component renders both; the bottom bar uses `fixed` so it escapes
 * the header flow. Active state via usePathname.
 */
type NavItem = { label: string; href: string; icon: IconName };

const PRIMARY: NavItem[] = [
  // CHEF-PR0: 5-tab "shift command app" IA — Vandaag · Open · Beschikbaar · Geld · Profiel.
  { label: "Vandaag", href: "/chef", icon: "dashboard" },
  { label: "Open", href: "/chef/open", icon: "plus-circle" },
  { label: "Beschikbaar", href: "/chef/availability", icon: "calendar" },
  { label: "Geld", href: "/chef/earnings", icon: "wallet" },
  { label: "Profiel", href: "/chef/profile", icon: "user-round" },
];

const MORE: NavItem[] = [
  { label: "Mijn shifts", href: "/chef/shifts", icon: "calendar-days" },
  { label: "Uren", href: "/chef/hours", icon: "clock" },
  { label: "Geld uitgelegd", href: "/chef/money", icon: "wallet" },
  { label: "Declaraties", href: "/chef/declaraties", icon: "banknote" },
  { label: "Mijn documenten", href: "/chef/documenten", icon: "inbox" },
  { label: "Meldingen", href: "/chef/notifications", icon: "bell" },
  { label: "Prikbord", href: "/chef/board", icon: "message" },
  { label: "Agenda-feed", href: "/chef/calendar", icon: "calendar-days" },
  { label: "Onboarding", href: "/chef/onboarding", icon: "check-circle" },
  { label: "Privacy", href: "/chef/privacy", icon: "shield-check" },
];

const ALL = [...PRIMARY, ...MORE];

function isActive(pathname: string, href: string): boolean {
  if (href === "/chef") return pathname === "/chef";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ChefNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE.some((n) => isActive(pathname, n.href));

  return (
    <>
      {/* Desktop: top pill row */}
      <nav className="mt-4 hidden flex-wrap gap-1 md:flex">
        {ALL.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-full px-3 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] ${
                active
                  ? "bg-burgundy/10 text-burgundy"
                  : "text-ink-700 hover:bg-burgundy/10 hover:text-burgundy"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: sticky bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-3xl items-stretch">
          {PRIMARY.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-burgundy" : "text-ink-600"
                }`}
              >
                <Icon name={n.icon} className="h-5 w-5" />
                {n.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Meer menu"
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              moreActive ? "text-burgundy" : "text-ink-600"
            }`}
          >
            <Icon name="list" className="h-5 w-5" />
            Meer
          </button>
        </div>
      </nav>

      {/* Mobile: "Meer" bottom sheet */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Sluiten"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-900/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto max-w-3xl px-4 py-4">
              <p className="font-ui text-[11px] uppercase tracking-[0.2em] text-ink-500">Meer</p>
              <div className="mt-2 divide-y divide-ink-100">
                {MORE.map((n) => {
                  const active = isActive(pathname, n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-[52px] items-center gap-3 text-sm ${
                        active ? "text-burgundy" : "text-ink-800"
                      }`}
                    >
                      <Icon name={n.icon} className="h-5 w-5" />
                      {n.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
