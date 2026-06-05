/**
 * Week staffing map — hotels × 7 days. Venue-first: each cell shows the day's
 * confirmed/headcount + a health dot, and surfaces open slots ("+N") so gaps pop.
 * A per-day totals footer + a per-hotel week-open badge give the planner demand vs
 * coverage at a glance. Clicking a cell jumps to that day's dispatch board.
 * Read + navigate only (no inline mutation — that stays on the Day board / Planner).
 */

import Link from "next/link";

import { HEALTH_META } from "@/components/admin/shiftVisuals";
import type { WeekHotelRow } from "@/lib/domain/roster-intel";

function fmtDay(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("nl-NL", { timeZone: "UTC", ...opts });
}

export function RosterWeekGrid({
  hotels,
  weekDays,
  todayKey,
}: {
  hotels: WeekHotelRow[];
  weekDays: string[];
  todayKey: string;
}) {
  if (hotels.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-ink-200 bg-white px-4 py-10 text-center text-sm text-ink-500">
        Geen diensten deze week.
      </p>
    );
  }

  // Per-day column totals across all hotels (view-only aggregation from the cells).
  const dayTotals = weekDays.map((d) => {
    let confirmed = 0;
    let headcount = 0;
    let open = 0;
    for (const h of hotels) {
      const c = h.cells.find((x) => x.dayKey === d);
      if (c) {
        confirmed += c.confirmed;
        headcount += c.headcount;
        open += c.openSlots;
      }
    }
    return { dayKey: d, confirmed, headcount, open };
  });
  const grandOpen = dayTotals.reduce((a, t) => a + t.open, 0);
  const grandConfirmed = dayTotals.reduce((a, t) => a + t.confirmed, 0);
  const grandHeadcount = dayTotals.reduce((a, t) => a + t.headcount, 0);
  const weekOpen = (h: WeekHotelRow) => h.cells.reduce((a, c) => a + c.openSlots, 0);

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr className="border-b border-ink-200">
            <th className="px-3 py-2 text-left font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">Hotel</th>
            {weekDays.map((d) => (
              <th
                key={d}
                className={`px-2 py-2 text-center font-ui text-[10px] uppercase tracking-wider ${d === todayKey ? "text-burgundy" : "text-ink-500"}`}
              >
                {fmtDay(d, { weekday: "short", day: "numeric" })}
              </th>
            ))}
            <th className="px-3 py-2 text-center font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">Week</th>
          </tr>
        </thead>
        <tbody>
          {hotels.map((h) => {
            const byDay = new Map(h.cells.map((c) => [c.dayKey, c]));
            const ho = weekOpen(h);
            return (
              <tr key={h.clientId} className="border-b border-ink-100 last:border-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {h.hasAttention && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
                    <span className="truncate font-ui text-[13px] text-ink-900">{h.companyName}</span>
                  </span>
                </td>
                {weekDays.map((d) => {
                  const c = byDay.get(d);
                  if (!c) return <td key={d} className="px-2 py-2 text-center text-ink-300">·</td>;
                  return (
                    <td key={d} className="px-2 py-2 text-center">
                      <Link
                        href={`/admin/business/roster?view=day&date=${d}`}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] hover:bg-bg-gray"
                        title={`${c.confirmed}/${c.headcount} bevestigd${c.openSlots > 0 ? ` · ${c.openSlots} open` : ""}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_META[c.health].dot}`} />
                        <span className="tabular-nums text-ink-700">{c.confirmed}/{c.headcount}</span>
                        {c.openSlots > 0 && (
                          <span className="font-ui text-[10px] font-medium tabular-nums text-amber-700">+{c.openSlots}</span>
                        )}
                      </Link>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center">
                  <span className="font-ui text-[12px] font-medium tabular-nums text-ink-900">
                    {h.totalConfirmed}/{h.totalHeadcount}
                  </span>
                  {ho > 0 && (
                    <span className="ml-1 font-ui text-[10px] font-medium tabular-nums text-amber-700">{ho} open</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink-200 bg-bg-gray/40">
            <td className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">Totaal</td>
            {dayTotals.map((t) => (
              <td key={t.dayKey} className="px-2 py-2 text-center">
                <span className="font-ui text-[12px] font-medium tabular-nums text-ink-900">
                  {t.confirmed}/{t.headcount}
                </span>
                {t.open > 0 && (
                  <span className="ml-1 font-ui text-[10px] font-medium tabular-nums text-amber-700">+{t.open}</span>
                )}
              </td>
            ))}
            <td className="px-3 py-2 text-center">
              <span className="font-ui text-[12px] font-semibold tabular-nums text-ink-900">
                {grandConfirmed}/{grandHeadcount}
              </span>
              {grandOpen > 0 && (
                <span className="ml-1 font-ui text-[10px] font-medium tabular-nums text-amber-700">{grandOpen} open</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
