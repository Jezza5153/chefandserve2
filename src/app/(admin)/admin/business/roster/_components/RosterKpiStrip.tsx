/**
 * KPI strip — clean stat tiles (label · big number · optional %-badge), each a
 * clickable filter. Matches the cockpit mockup: no icons/CTAs, just the numbers.
 */

import Link from "next/link";

export type KpiTile = {
  key: string;
  label: string;
  value: string | number;
  pct?: number;
  /** optional sub-line (e.g. week/month role breakdown). */
  detail?: string;
  tone: "ok" | "amber" | "red";
  href: string;
};

export function RosterKpiStrip({ items }: { items: KpiTile[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((k) => {
        // Only the Kritiek tile gets weight, and only when there's something critical.
        const critical = k.key === "kritiek" && Number(k.value) > 0;
        return (
          <Link
            key={k.key}
            href={k.href}
            className={`rounded-xl border bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(41,41,42,0.04)] transition-colors hover:border-burgundy/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy ${
              critical ? "border-red-200 bg-red-50/40" : "border-ink-200"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">{k.label}</p>
              {typeof k.pct === "number" && (
                <span
                  className={`shrink-0 rounded-full font-ui text-[11px] font-semibold ${
                    k.tone === "red" ? "bg-red-50 px-1.5 py-0.5 text-red-600" : k.tone === "amber" ? "bg-amber-50 px-1.5 py-0.5 text-amber-700" : "text-ink-400"
                  }`}
                >
                  {k.pct}%
                </span>
              )}
            </div>
            <p className={`mt-1.5 font-serif text-[30px] leading-none tabular-nums ${critical ? "text-red-700" : "text-ink-900"}`}>{k.value}</p>
            {k.detail && <p className="mt-1 truncate text-[11px] text-ink-500">{k.detail}</p>}
          </Link>
        );
      })}
    </div>
  );
}
