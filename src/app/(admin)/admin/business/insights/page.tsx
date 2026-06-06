/**
 * /admin/business/insights — KPI-4 + KPI-5. Owner-only analytics over the KPI snapshot.
 * Read-only. Money rollups + bezetting (KPI-5), the dark-launched 48h forecast
 * (KPI_FORECAST_ENABLED), and the ranglijsten (KPI-4). Every number is deterministic +
 * honest; the only estimate (capacity utilization) is labelled with its assumption.
 */
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { forecastEnabled, getForecast } from "@/lib/domain/forecast";
import { getLeaderboards } from "@/lib/domain/leaderboards";
import { getPlatformRollups, type FillBreakdown, type MoneyWindow } from "@/lib/domain/platform-rollups";
import { formatEuro } from "@/lib/hours-labels";
import { formatChefRole, formatSegment } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Analyse", robots: { index: false } };
export const dynamic = "force-dynamic";

const SECTION = "font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500";
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

export default async function InsightsPage() {
  await requirePermission("cockpit", "read");
  const wantForecast = forecastEnabled();
  const [lb, roll, forecast] = await Promise.all([
    getLeaderboards(90, 5),
    getPlatformRollups(),
    wantForecast ? getForecast() : Promise.resolve(null),
  ]);
  const lbEmpty = lb.topEarners.length === 0 && lb.busiest.length === 0 && lb.topClients.length === 0;

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Analyse</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">Inzichten</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Opgebouwd uit de dagelijkse snapshot — bedragen uit goedgekeurde uren, bezetting over
          gerealiseerde diensten. Geen schattingen tenzij expliciet vermeld.
        </p>
      </header>

      <section>
        <h2 className={SECTION}>Omzet &amp; marge</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <MoneyCard title="Deze week" w={roll.week} />
          <MoneyCard title="Laatste 30 dagen" w={roll.month} />
          <MoneyCard title="Dit jaar" w={roll.ytd} />
        </div>
      </section>

      <section>
        <h2 className={SECTION}>Bezetting · laatste {roll.fillWindowDays} dagen</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <FillCard title="Per rol" rows={roll.fillByRole} label={formatChefRole} />
          <FillCard title="Per segment" rows={roll.fillBySegment} label={formatSegment} />
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          Totaal {pct(roll.overallFill.rate)} bezet ({roll.overallFill.filled}/{roll.overallFill.slots} plekken).
          {roll.capacity.utilizationPct != null ? (
            <>
              {" "}
              · Capaciteit-<b>schatting</b>: {roll.capacity.utilizationPct}% benut — aanname{" "}
              {roll.capacity.assumedHoursPerChefPerWeek} u/chef/week over {roll.activeChefs} actieve chefs
              ({roll.workedHours} u gewerkt). Geen harde beschikbaarheidsdata, dus richtcijfer.
            </>
          ) : null}
        </p>
      </section>

      {forecast ? (
        <section>
          <h2 className={`${SECTION} flex items-center gap-2`}>
            Vooruitblik · komende 48 uur
            <span className="rounded-full bg-burgundy/10 px-2 py-0.5 text-[9px] font-medium normal-case tracking-normal text-burgundy">
              projectie
            </span>
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Onderbezetting per rol</p>
              {forecast.understaffingByRole.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-ink-900">
                  {forecast.understaffingByRole.map((u) => (
                    <li key={u.role} className="flex justify-between gap-2">
                      <span>{formatChefRole(u.role)}</span>
                      <span className="text-burgundy">{u.needed} open</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-500">Geen open plekken in de komende 48 uur.</p>
              )}
              <p className="mt-2 text-[11px] text-ink-400">{forecast.totalOpenSlots} open plekken totaal</p>
            </div>
            <div className="rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Risico op uitval</p>
              <p className="mt-1 text-3xl font-semibold text-ink-900">{forecast.churnRiskCount}</p>
              <p className="mt-1 text-xs text-ink-500">chefs eerder actief, nu &gt; 30 dagen stil</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Projectie op basis van het huidige rooster + recente activiteit — geen voorspelling.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className={SECTION}>Ranglijsten · laatste {lb.windowDays} dagen</h2>
        {lbEmpty ? (
          <div className="mt-3 rounded-lg border border-dashed border-ink-200 bg-bg-gray/40 p-6 text-sm text-ink-500">
            Nog geen snapshot-data in dit venster. De ranglijsten vullen zich zodra de nachtelijke
            <span className="font-mono"> metrics-snapshot</span> heeft gedraaid (of na een handmatige backfill).
          </div>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <LeaderboardCard title="Top verdieners" icon="banknote" entries={lb.topEarners} />
            <LeaderboardCard title="Meeste diensten" icon="activity" entries={lb.busiest} />
            <LeaderboardCard
              title="Meest betrouwbaar"
              icon="check-circle"
              entries={lb.mostReliable}
              emptyHint="Nog niemand met ≥ 5 voorstellen in dit venster."
            />
            <LeaderboardCard
              title="Best beoordeeld"
              icon="sparkles"
              entries={lb.highestRated}
              emptyHint="Nog niemand met ≥ 5 reviews in dit venster."
            />
            <LeaderboardCard title="Grootste klanten" icon="building" entries={lb.topClients} />
          </div>
        )}
      </section>
    </div>
  );
}

function MoneyCard({ title, w }: { title: string; w: MoneyWindow }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{formatEuro(w.revenueCents)}</p>
      <p className="text-[11px] text-ink-500">omzet</p>
      <dl className="mt-3 space-y-1 text-xs text-ink-600">
        <div className="flex justify-between gap-2">
          <dt>Loonkost</dt>
          <dd className="tabular-nums">{formatEuro(w.loonCostCents)}</dd>
        </div>
        <div className="flex justify-between gap-2 font-medium text-ink-900">
          <dt>Marge</dt>
          <dd className="tabular-nums">{formatEuro(w.marginCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

function FillCard({
  title,
  rows,
  label,
}: {
  title: string;
  rows: FillBreakdown[];
  label: (v: string) => string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ink-400">Geen gerealiseerde diensten in dit venster.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-ink-900">{label(r.key) || r.key}</span>
                <span className="shrink-0 text-ink-600">
                  {pct(r.rate)} <span className="text-ink-400">({r.filled}/{r.slots})</span>
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-ink-100">
                <div
                  className="h-1 rounded-full bg-burgundy/60"
                  style={{ width: `${Math.min(100, Math.round((r.rate ?? 0) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
