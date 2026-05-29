/**
 * Week staffing map — hotels × 7 days. Venue-first: each cell shows the day's
 * confirmed/headcount + a health dot; clicking a cell jumps to that day's
 * dispatch board. Read + navigate. Hotels with attention are flagged.
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
                      </Link>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-ui text-[12px] font-medium tabular-nums text-ink-900">
                  {h.totalConfirmed}/{h.totalHeadcount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
