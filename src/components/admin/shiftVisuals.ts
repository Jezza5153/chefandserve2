/**
 * Shift visual vocabulary — single source of the locked colour language for
 * shift health / fill, shared by the roster grid card AND the dashboard table.
 * Pure (no React), so it stays a plain module. Tones follow the LOCKED palette:
 * red = kritiek · amber = risico/onbekend/onderbezet · green = gezond/compleet ·
 * grey = afgerond/geannuleerd.
 */

import type { FillState, ShiftHealth } from "@/lib/roster-format";

/** Roster card / month-dot tones + Dutch labels (moved here from RosterShiftCard). */
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

export const FILL_META: Record<FillState, string> = {
  full: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-800",
  empty: "bg-amber-100 text-amber-800",
  emptySoon: "bg-red-100 text-red-700",
  unknown: "bg-amber-100 text-amber-800",
  done: "bg-bg-gray text-ink-500",
  cancelled: "bg-bg-gray text-ink-500",
};

/** Dashboard-table status chip: "Compleet / N open / Niet ingevuld" + tones. */
export type StatusChip = { label: string; dot: string; text: string };

export function shiftStatusChip(input: {
  status: string;
  confirmedCount: number;
  headcount: number;
}): StatusChip {
  if (input.status === "cancelled")
    return { label: "Geannuleerd", dot: "bg-ink-400", text: "text-ink-500" };
  if (input.status === "completed")
    return { label: "Afgerond", dot: "bg-ink-400", text: "text-ink-500" };
  if (input.headcount <= 0)
    return { label: "Geen bezetting", dot: "bg-amber-500", text: "text-amber-800" };
  if (input.confirmedCount >= input.headcount)
    return { label: "Compleet", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (input.confirmedCount === 0)
    return { label: "Niet ingevuld", dot: "bg-red-500", text: "text-red-700" };
  const open = input.headcount - input.confirmedCount;
  return { label: `${open} open`, dot: "bg-amber-500", text: "text-amber-800" };
}
