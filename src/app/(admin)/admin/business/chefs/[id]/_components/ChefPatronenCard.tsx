/**
 * Chef "Patronen & relaties" — PR-INTEL. The relationship + pattern layer on top
 * of Chef 360: when this chef works (weekday histogram), which roles, what they've
 * earned (lifetime + 30d), and which klanten they earn the most with. Read-only,
 * server-rendered. Data from getChefPatterns().
 */
import type { ChefPatterns } from "@/lib/domain/intel";
import type { LegacyChefProfile } from "@/lib/domain/chef-legacy-profile";
import { formatEuro } from "@/lib/hours-labels";
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

export function ChefPatronenCard({
  patterns,
  legacy,
}: {
  patterns: ChefPatterns;
  /** Migrated history — the card used to claim "nog geen werkpatroon" while this existed. */
  legacy?: LegacyChefProfile | null;
}) {
  const maxDay = Math.max(1, ...patterns.preferredDays.map((d) => d.count));
  const hasData = patterns.preferredDays.some((d) => d.count > 0);

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-ink-900">Patronen &amp; relaties</h2>
        {patterns.busiestDayLabel ? (
          <p className="text-xs text-ink-500">
            Werkt meestal op{" "}
            <strong className="text-ink-900">
              {FULL_DAY[patterns.busiestDayLabel] ?? patterns.busiestDayLabel}
            </strong>
          </p>
        ) : null}
      </div>

      {!hasData && legacy ? (
        /* No patterns in THIS system yet, but a real track record before it. Saying
           "nog geen werkpatroon" here was the system contradicting its own notes. */
        <div className="mt-3">
          <p className="text-sm text-ink-700">
            Nog geen diensten in dit systeem — hieronder de staat van dienst uit het oude systeem.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className={LABEL}>Uren gewerkt</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">±{legacy.urenGewerkt.toLocaleString("nl-NL")}</p>
            </div>
            <div>
              <p className={LABEL}>Uitnodigingen</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">{legacy.uitnodigingen}</p>
            </div>
            <div>
              <p className={LABEL}>Klanten</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">{legacy.klanten}</p>
            </div>
            <div>
              <p className={LABEL}>Beoordeling</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">
                {legacy.beoordeling != null ? `${legacy.beoordeling}/10` : "—"}
              </p>
              {legacy.beoordeling != null ? (
                <p className="text-[11px] text-ink-500">{legacy.beoordelingen}× · schaal oude systeem</p>
              ) : null}
            </div>
          </div>
          {legacy.topKlanten.length > 0 ? (
            <div className="mt-4">
              <p className={LABEL}>Werkte vooral bij</p>
              <ul className="mt-2 space-y-1">
                {legacy.topKlanten.map((k) => (
                  <li key={k.naam} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-ink-800">
                      {k.clientId ? (
                        <a href={`/admin/business/clients/${k.clientId}`} className="hover:text-burgundy">{k.naam}</a>
                      ) : (
                        k.naam
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-600">
                      ±{k.uren.toLocaleString("nl-NL")} u{k.beoordeling != null ? ` · ${k.beoordeling}/10` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : !hasData ? (
        <p className="mt-3 text-sm text-ink-500">
          Nog geen werkpatroon — deze chef heeft nog geen afgeronde diensten.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className={LABEL}>Totaal verdiend</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">
                {formatEuro(patterns.totalEarnedCents)}
              </p>
            </div>
            <div>
              <p className={LABEL}>Laatste 30 dagen</p>
              <p className="mt-1 text-lg font-semibold text-ink-900">
                {formatEuro(patterns.earned30dCents)}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className={LABEL}>Werkdagen</p>
            <div className="mt-2 flex items-stretch gap-1.5">
              {patterns.preferredDays.map((d) => (
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

          {patterns.clientEarnings.length > 0 ? (
            <div className="mt-5">
              <p className={LABEL}>Verdiend per klant</p>
              <ul className="mt-2 divide-y divide-ink-100">
                {patterns.clientEarnings.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-ink-700">
                      {c.name}{" "}
                      <span className="text-ink-400">
                        · {c.shifts} {c.shifts === 1 ? "dienst" : "diensten"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-ink-900">{formatEuro(c.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
