/**
 * TrendChart — a labeled, responsive bar chart for a single metric over time.
 * Zero deps, server-rendered (pure markup; the `title` attr gives a hover value
 * without any JS). Bars scale to the window max — it shows SHAPE, so always pair
 * it with a real headline number. The most-recent bar is highlighted.
 */
export type TrendPoint = { label: string; value: number };

export function TrendChart({
  points,
  format,
  barClassName = "bg-burgundy/30",
  lastBarClassName = "bg-burgundy",
}: {
  points: TrendPoint[];
  /** Formats the hover/title value (e.g. euro or percent). */
  format?: (v: number) => string;
  barClassName?: string;
  lastBarClassName?: string;
}) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-500">Nog geen data.</p>;
  }
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));

  return (
    <div className="flex items-stretch gap-1" role="img" aria-label="Trend per periode">
      {points.map((p, i) => {
        const pct = (Math.abs(p.value) / max) * 100;
        const last = i === points.length - 1;
        return (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-28 w-full items-end">
              <div
                title={`${p.label}: ${format ? format(p.value) : String(p.value)}`}
                className={`w-full rounded-t transition-colors ${last ? lastBarClassName : barClassName} hover:bg-burgundy/60`}
                style={{ height: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="mt-1 truncate text-[9px] tabular-nums text-ink-500">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}
