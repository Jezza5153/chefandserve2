/**
 * TrendTile — KPI-2/3 shared. A single KPI trend tile: the real "this week" number,
 * a noise-guarded delta (▲/▼ only when the baseline is meaningful — see
 * noiseGuardedDelta), and an 8-week sparkline of shape. Used on Chef 360 + Klant 360.
 */
import { Sparkline } from "@/components/dashboard/Sparkline";
import { type PeriodDelta } from "@/lib/domain/metrics-history";

function fmtDelta(d: PeriodDelta): { text: string; tone: "up" | "down" | "flat" } | null {
  if (d.mode === "arrow") {
    if (d.dir === "flat") return { text: "gelijk", tone: "flat" };
    return { text: `${d.dir === "up" ? "▲" : "▼"} ${Math.abs(d.diff)}`, tone: d.dir };
  }
  if (d.mode === "plain") return { text: `vorige: ${d.prevPeriod}`, tone: "flat" };
  return null;
}

export function TrendTile({
  label,
  value,
  spark,
  delta,
}: {
  label: string;
  value: string;
  spark: number[];
  delta: PeriodDelta;
}) {
  const d = fmtDelta(delta);
  const toneCls = d?.tone === "up" ? "text-emerald-700" : d?.tone === "down" ? "text-red-600" : "text-ink-500";
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{label}</span>
        {d ? <span className={`font-ui text-[11px] font-medium ${toneCls}`}>{d.text}</span> : null}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-lg font-semibold leading-none text-ink-900">{value}</span>
        <Sparkline values={spark} ariaLabel={`${label} trend over ${spark.length} weken`} />
      </div>
      <span className="mt-1 block text-[10px] text-ink-400">deze week</span>
    </div>
  );
}
