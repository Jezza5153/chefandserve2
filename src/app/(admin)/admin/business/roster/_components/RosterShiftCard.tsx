import Link from "next/link";

import type { FillState, ShiftHealth } from "@/lib/roster-format";

/** Locked visual language → Tailwind tones + Dutch labels. Reused by month dots. */
export const HEALTH_META: Record<
  ShiftHealth,
  { label: string; dot: string; badge: string }
> = {
  healthy: { label: "Gezond", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700" },
  attention: { label: "Aandacht", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800" },
  underfilled: { label: "Onderbezet", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800" },
  empty: { label: "Geen chef", dot: "bg-amber-600", badge: "bg-amber-100 text-amber-800" },
  critical: { label: "Kritiek", dot: "bg-red-500", badge: "bg-red-100 text-red-700" },
  done: { label: "Afgerond", dot: "bg-ink-500", badge: "bg-bg-gray text-ink-500" },
  cancelled: { label: "Geannuleerd", dot: "bg-ink-500", badge: "bg-bg-gray text-ink-500" },
};

const FILL_META: Record<FillState, string> = {
  full: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-800",
  empty: "bg-amber-100 text-amber-800",
  emptySoon: "bg-red-100 text-red-700",
  unknown: "bg-amber-100 text-amber-800",
  done: "bg-bg-gray text-ink-500",
  cancelled: "bg-bg-gray text-ink-500",
};

function time(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type RosterCardShift = {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  roleNeeded: string;
  segment: string | null;
  headcount: number;
  city: string | null;
  location: string | null;
  companyName: string | null;
  confirmedCount: number;
};

export type RosterCardIntel = {
  health: ShiftHealth;
  nextAction: string;
  warnings: string[];
  fill: FillState;
};

export function RosterShiftCard({
  shift,
  intel,
}: {
  shift: RosterCardShift;
  intel: RosterCardIntel;
}) {
  const h = HEALTH_META[intel.health];
  return (
    <Link
      href={`/admin/business/shifts/${shift.id}`}
      className="block min-h-[44px] rounded-lg border border-ink-200 bg-white p-3 transition-colors hover:border-burgundy/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-ui text-xs font-medium text-ink-900">
          {time(shift.startsAt)}–{time(shift.endsAt)}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-ui text-[9px] font-medium uppercase tracking-wider ${h.badge}`}
        >
          {h.label}
        </span>
      </div>
      <p className="mt-1 truncate font-serif text-sm text-ink-900">
        {shift.companyName ?? "Onbekende klant"}
      </p>
      <p className="truncate text-xs text-ink-500">
        {shift.roleNeeded}
        {shift.segment ? ` · ${shift.segment}` : ""}
        {shift.city ? ` · ${shift.city}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium ${FILL_META[intel.fill]}`}
        >
          {shift.confirmedCount}/{shift.headcount} bevestigd
        </span>
        <span className="font-ui text-[10px] font-medium uppercase tracking-wider text-burgundy">
          {intel.nextAction}
        </span>
      </div>
      {intel.warnings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {intel.warnings.slice(0, 2).map((w) => (
            <span
              key={w}
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
