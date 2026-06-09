/**
 * Klant "Patronen & relaties" — PR-INTEL. The relationship + pattern layer on top
 * of Klant 360: when this klant books work (weekday histogram), which roles they
 * book, and which chefs they keep coming back to. Read-only, server-rendered.
 * Data from getClientPatterns(). No money/earnings — this card is about booking
 * patterns + chef relationships.
 */
import type { ClientPatterns } from "@/lib/domain/intel";
import { formatChefRole } from "@/lib/labels";

const FULL_DAY: Record<string, string> = {
  Ma: "maandag",
  Di: "dinsdag",
  Wo: "woensdag",
  Do: "donderdag",
  Vr: "vrijdag",
  Za: "zaterdag",
  Zo: "zondag",
};

const LABEL = "font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500";

export function KlantPatronenCard({ patterns }: { patterns: ClientPatterns }) {
  const maxDay = Math.max(1, ...patterns.bookingDays.map((d) => d.count));
  const hasData = patterns.bookingDays.some((d) => d.count > 0);

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-ink-900">Patronen &amp; relaties</h2>
        {patterns.busiestDayLabel ? (
          <p className="text-xs text-ink-500">
            Boekt meestal op{" "}
            <strong className="text-ink-900">
              {FULL_DAY[patterns.busiestDayLabel] ?? patterns.busiestDayLabel}
            </strong>
          </p>
        ) : null}
      </div>

      {!hasData ? (
        <p className="mt-3 text-sm text-ink-500">
          Nog geen boekingspatroon — deze klant heeft nog geen diensten.
        </p>
      ) : (
        <>
          <div className="mt-5">
            <p className={LABEL}>Boekingsdagen</p>
            <div className="mt-2 flex items-stretch gap-1.5">
              {patterns.bookingDays.map((d) => (
                <div key={d.weekday} className="flex flex-1 flex-col items-center">
                  <div className="flex h-14 w-full items-end">
                    <div
                      title={`${d.label}: ${d.count}`}
                      className="w-full rounded-t bg-burgundy/40"
                      style={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-ink-500">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {patterns.roleMix.length > 0 ? (
            <div className="mt-5">
              <p className={LABEL}>Rollen</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {patterns.roleMix.map((r) => (
                  <span
                    key={r.role}
                    className="rounded-full border border-ink-200 bg-bg-gray px-2.5 py-1 text-xs text-ink-700"
                  >
                    {formatChefRole(r.role)} · {r.count}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <p className={LABEL}>Vaste chefs</p>
            {patterns.repeatChefs.length > 0 ? (
              <ul className="mt-2 divide-y divide-ink-100">
                {patterns.repeatChefs.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink-700">{c.name}</span>
                    <span className="shrink-0 text-ink-900">
                      {c.count} {c.count === 1 ? "dienst" : "diensten"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-500">
                Nog geen vaste chefs (≥2 diensten).
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
