/**
 * LeaderboardCard — KPI-4. Renders one ranked board (top earners / busiest / …) from
 * leaderboards.ts. Server-rendered, presentational: rank · name · preformatted value,
 * a subtle proportional bar, and optional supporting context. Cold-start safe (empty
 * state with a hint).
 */
import { Icon, type IconName } from "@/components/admin/icons";
import { type LeaderboardEntry } from "@/lib/domain/leaderboards";

export function LeaderboardCard({
  title,
  icon,
  entries,
  emptyHint,
}: {
  title: string;
  icon: IconName;
  entries: LeaderboardEntry[];
  emptyHint?: string;
}) {
  const max = Math.max(1, ...entries.map((e) => Math.abs(e.value)));
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
        <Icon name={icon} className="h-4 w-4 text-burgundy" />
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-ink-400">{emptyHint ?? "Nog geen data in dit venster."}</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {entries.map((e, i) => (
            <li key={e.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-4 shrink-0 text-right font-ui text-[11px] tabular-nums text-ink-400">{i + 1}</span>
                  <span className="truncate text-sm text-ink-900">{e.name}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink-900">{e.display}</span>
              </div>
              <div className="ml-6 mt-1 h-1 rounded-full bg-ink-100">
                <div
                  className="h-1 rounded-full bg-burgundy/60"
                  style={{ width: `${Math.max(3, Math.round((Math.abs(e.value) / max) * 100))}%` }}
                />
              </div>
              {e.sub ? <p className="ml-6 mt-0.5 text-[10px] text-ink-400">{e.sub}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
