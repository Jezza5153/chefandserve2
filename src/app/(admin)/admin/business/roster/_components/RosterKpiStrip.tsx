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

const PCT_TONE: Record<KpiTile["tone"], string> = {
  ok: "text-ink-400",
  amber: "text-amber-700",
  red: "text-red-600",
};

export function RosterKpiStrip({ items }: { items: KpiTile[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((k) => (
        <Link
          key={k.key}
          href={k.href}
          className="rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 transition-colors hover:border-burgundy/40"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-ui text-[9px] uppercase tracking-[0.12em] text-ink-500">{k.label}</p>
            {typeof k.pct === "number" && (
              <span className={`shrink-0 font-ui text-[10px] font-semibold ${PCT_TONE[k.tone]}`}>{k.pct}%</span>
            )}
          </div>
          <p className="mt-1 font-serif text-[26px] leading-none text-ink-900">{k.value}</p>
          {k.detail && <p className="mt-1 truncate text-[10px] text-ink-500">{k.detail}</p>}
        </Link>
      ))}
    </div>
  );
}
