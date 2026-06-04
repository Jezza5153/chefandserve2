/**
 * Month planning radar — a calendar tinted by RISK (not raw busyness): a day
 * with a kritiek shift is red, an under-staffed day (fill < 70%) is amber, an
 * on-schema day is green. The number shown is bezetting% (confirmed/headcount).
 * Below: meest-actieve-hotels + rol-tekorten (actual open per dagdeel). Each day
 * links to that day's dispatch board. Read + navigate.
 */

import Link from "next/link";

import { dagdeelLabel, type Dagdeel, type MonthDayCell } from "@/lib/domain/roster-intel";

function cellTone(c: MonthDayCell): { box: string; text: string } {
  if (!c.inMonth || c.shiftCount === 0) return { box: "bg-bg-gray/40", text: "text-ink-300" };
  if (c.kritiek) return { box: "bg-red-50", text: "text-red-700" };
  if (c.bezettingPct != null && c.bezettingPct < 70) return { box: "bg-amber-50", text: "text-amber-800" };
  return { box: "bg-emerald-50", text: "text-emerald-700" };
}

export function RosterMonthHeatmap({
  cells,
  todayKey,
  topHotels = [],
  roleShortage = [],
  hotelsMetAandacht,
}: {
  cells: MonthDayCell[];
  todayKey: string;
  topHotels?: { companyName: string; shiftCount: number; openSlots: number }[];
  roleShortage?: { dagdeel: Dagdeel; open: number }[];
  hotelsMetAandacht?: { count: number; names: string[] };
}) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="grid grid-cols-7 gap-px rounded-t-lg border border-ink-200 bg-ink-200 text-center font-ui text-[10px] uppercase tracking-wider text-ink-500">
          {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
            <div key={d} className="bg-bg-gray py-1.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg border-x border-b border-ink-200 bg-ink-200">
          {cells.map((c) => {
            const tone = cellTone(c);
            const isToday = c.dayKey === todayKey;
            return (
              <Link
                key={c.dayKey}
                href={`/admin/business/roster?view=day&date=${c.dayKey}`}
                className={`flex min-h-[68px] flex-col p-1.5 ${tone.box} hover:ring-1 hover:ring-inset hover:ring-burgundy/40`}
              >
                <span className={`font-ui text-[11px] ${isToday ? "font-bold text-burgundy" : c.inMonth ? "text-ink-700" : "text-ink-300"}`}>
                  {Number(c.dayKey.slice(8))}
                </span>
                {c.shiftCount > 0 && (
                  <span className="mt-auto">
                    <span className={`block font-ui text-[13px] font-semibold tabular-nums ${tone.text}`}>
                      {c.bezettingPct ?? 0}%
                    </span>
                    <span className="block text-[10px] text-ink-400">{c.shiftCount} {c.shiftCount === 1 ? "dienst" : "diensten"}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 font-ui text-[10px] text-ink-500">
          <Legend dot="bg-emerald-500" label="op schema (≥70%)" />
          <Legend dot="bg-amber-500" label="onderbezet (<70%)" />
          <Legend dot="bg-red-500" label="kritieke dag" />
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-lg border border-ink-200 bg-white p-4">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.16em] text-burgundy">Meest actieve hotels</h2>
          {topHotels.length === 0 ? (
            <p className="mt-2 text-sm text-ink-400">Geen diensten deze maand.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {topHotels.map((h) => (
                <li key={h.companyName} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-ink-900">{h.companyName}</span>
                  <span className="shrink-0 font-ui text-[11px] text-ink-500">
                    {h.shiftCount} diensten{h.openSlots > 0 ? ` · ${h.openSlots} open` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-ink-200 bg-white p-4">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.16em] text-burgundy">Rol tekorten</h2>
          {roleShortage.length === 0 ? (
            <p className="mt-2 text-sm text-ink-400">Geen open plekken.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {roleShortage.map((r) => (
                <li key={r.dagdeel} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-900">{dagdeelLabel(r.dagdeel)}</span>
                  <span className="font-ui text-[11px] font-medium text-amber-800">{r.open} open</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {hotelsMetAandacht && hotelsMetAandacht.count > 0 ? (
          <section className="rounded-lg border border-ink-200 bg-white p-4">
            <h2 className="font-ui text-[10px] uppercase tracking-[0.16em] text-burgundy">Hotels met aandacht</h2>
            <p className="mt-2 text-sm text-ink-900">
              <b>{hotelsMetAandacht.count}</b> {hotelsMetAandacht.count === 1 ? "hotel" : "hotels"} met open of kritieke diensten
            </p>
            {hotelsMetAandacht.names.length > 0 ? (
              <p className="mt-1 text-[11px] text-ink-500">{hotelsMetAandacht.names.join(" · ")}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
