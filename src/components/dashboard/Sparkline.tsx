/**
 * Sparkline — KPI-2. Tiny inline-SVG weekly bar chart: zero deps, server-rendered,
 * purely presentational. It shows SHAPE only (bars scaled to the window max), so
 * always pair it with a real number + delta — never read absolute scale off it.
 * The most-recent bar is highlighted in burgundy; earlier bars are ink-300.
 */
type Props = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({ values, width = 104, height = 28, className, ariaLabel }: Props) {
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const gap = 2;
  const barW = (width - gap * (n - 1)) / n;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `trend over ${n} weken`}
      className={className}
      preserveAspectRatio="none"
    >
      {values.map((v, i) => {
        const h = (Math.abs(v) / max) * (height - 2);
        const x = i * (barW + gap);
        const drawn = Math.max(v === 0 ? 0.5 : 2, h);
        return (
          <rect
            key={i}
            x={x}
            y={height - drawn}
            width={Math.max(1, barW)}
            height={drawn}
            rx={1}
            className={i === n - 1 ? "fill-burgundy-700" : "fill-ink-300"}
          />
        );
      })}
    </svg>
  );
}
