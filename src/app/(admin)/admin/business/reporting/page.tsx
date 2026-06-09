/**
 * /admin/business/reporting — unified owner report (PR-REPORT-C).
 *
 * Composes the existing point-in-time KPIs (platform-rollups, planner-report,
 * leaderboards) AND adds the time dimension the other pages lack: revenue /
 * margin / fill bucketed weekly (≈13 wk) or monthly (12 mo), toggled via ?range.
 */
import Link from "next/link";

import { DaglijstCard } from "@/components/dashboard/DaglijstCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { MoneyStrip } from "@/components/dashboard/MoneyStrip";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { getLeaderboards } from "@/lib/domain/leaderboards";
import { getPlatformRollups } from "@/lib/domain/platform-rollups";
import { getPlannerReport } from "@/lib/domain/planner-intel";
import { getUnbilledHoursByClient } from "@/lib/domain/invoicing";
import {
  getPlatformIntelKpis,
  getReactivationChefs,
  getQuietClients,
} from "@/lib/domain/intel";
import {
  detectSwing,
  getChefRevenueBreakdown,
  getClientRevenueBreakdown,
  getPlatformTimeSeries,
  type EntityRevenue,
} from "@/lib/domain/reporting";
import { formatEuro } from "@/lib/hours-labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Rapportage", robots: { index: false } };
export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requirePermission("cockpit", "read");
  const sp = await searchParams;
  const bucket: "week" | "month" = sp.range === "month" ? "month" : "week";

  const rangeDays = bucket === "month" ? 365 : 90;
  const [
    rollups,
    series,
    planner,
    leaders,
    clientBreakdown,
    chefBreakdown,
    unbilled,
    intelKpis,
    reactivationChefs,
    quietClients,
  ] = await Promise.all([
    getPlatformRollups(),
    getPlatformTimeSeries({ bucket }),
    getPlannerReport(),
    getLeaderboards(rangeDays, 5),
    getClientRevenueBreakdown(rangeDays, { limit: 10 }),
    getChefRevenueBreakdown(rangeDays, { limit: 10 }),
    getUnbilledHoursByClient(),
    getPlatformIntelKpis(),
    getReactivationChefs(),
    getQuietClients(),
  ]);

  const unbilledTotal = unbilled.reduce((sum, u) => sum + u.totalCents, 0);
  const revenueSwing = detectSwing(series.points, "revenueCents");
  const bucketWord = bucket === "week" ? "week" : "maand";

  const windowLabel = bucket === "week" ? "laatste 13 weken" : "laatste 12 maanden";
  const revenuePoints = series.points.map((p) => ({ label: p.label, value: p.revenueCents }));
  const marginPoints = series.points.map((p) => ({ label: p.label, value: p.marginCents }));
  const fillPoints = series.points.map((p) => ({
    label: p.label,
    value: p.fillRate == null ? 0 : Math.round(p.fillRate * 100),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Operations</p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">Rapportage</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Het bedrijf over tijd: omzet, marge en bezetting per periode, plus de
        ranglijsten. Cijfers komen uit afgeronde uren — concepten tellen nooit mee.
      </p>

      {/* Anomaly nudge — noise-guarded week/maand swing */}
      {revenueSwing ? (
        <p
          className={`mt-4 rounded border px-4 py-2 text-sm ${
            revenueSwing.direction === "down"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {revenueSwing.direction === "down" ? "↓" : "↑"} Omzet deze {bucketWord} is{" "}
          <strong>
            {revenueSwing.pct}% {revenueSwing.direction === "down" ? "lager" : "hoger"}
          </strong>{" "}
          dan de vorige {bucketWord} ({formatEuro(revenueSwing.prevCents)} →{" "}
          {formatEuro(revenueSwing.lastCents)}).
        </p>
      ) : null}

      {/* Insight → action: approved hours waiting to be invoiced */}
      {unbilledTotal > 0 ? (
        <Link
          href="/admin/business/invoices"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 hover:border-burgundy/40"
        >
          <span className="text-sm text-ink-700">
            <strong className="text-ink-900">{formatEuro(unbilledTotal)}</strong> aan goedgekeurde
            uren wacht op een factuur ({unbilled.length}{" "}
            {unbilled.length === 1 ? "klant" : "klanten"}).
          </span>
          <span className="shrink-0 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Te factureren →
          </span>
        </Link>
      ) : null}

      {/* Headline money */}
      <div className="mt-8">
        <MoneyStrip week={rollups.week} month={rollups.month} ytd={rollups.ytd} />
      </div>

      {/* Maarten's daglijst — proactive relationship signals (PR-INTEL-P7) */}
      <div className="mt-8">
        <DaglijstCard
          reactivationChefs={reactivationChefs}
          quietClients={quietClients}
        />
      </div>

      {/* Range toggle */}
      <div className="mt-8 flex items-center gap-2">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
          Periode
        </span>
        <RangePill href="/admin/business/reporting?range=week" active={bucket === "week"}>
          Per week
        </RangePill>
        <RangePill href="/admin/business/reporting?range=month" active={bucket === "month"}>
          Per maand
        </RangePill>
      </div>

      {/* Trends */}
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Omzet"
          headline={formatEuro(series.totals.revenueCents)}
          sub={windowLabel}
        >
          <TrendChart points={revenuePoints} format={formatEuro} />
        </ChartCard>
        <ChartCard
          title="Marge"
          headline={formatEuro(series.totals.marginCents)}
          sub={windowLabel}
        >
          <TrendChart points={marginPoints} format={formatEuro} />
        </ChartCard>
        <ChartCard
          title="Bezettingsgraad"
          headline={pct(series.totals.fillRate)}
          sub={`gemiddeld · ${windowLabel}`}
        >
          <TrendChart points={fillPoints} format={(v) => `${Math.round(v)}%`} />
        </ChartCard>
      </section>

      {/* Planner KPIs */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Intake (7 dagen)"
          value={String(planner.intakeThis7d)}
          sub={`vorige week: ${planner.intakePrev7d}`}
        />
        <StatTile
          label="Bezetting (30 dagen)"
          value={pct(planner.fillRate30d)}
          sub={`${planner.fillFilled}/${planner.fillSlots} plekken gevuld`}
        />
        <StatTile
          label="Mediane reactietijd"
          value={planner.medianResponseMin != null ? `${planner.medianResponseMin} min` : "—"}
          sub="chefs op een voorstel · 30 dagen"
        />
      </section>

      {/* Intel KPIs — relaties + responsiviteit */}
      <section className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Gem. tekensnelheid klant"
          value={intelKpis.avgSigningHours != null ? `${intelKpis.avgSigningHours} u` : "—"}
          sub="uren indienen → akkoord · 90 dagen"
        />
        <StatTile
          label="Actieve chefs"
          value={String(intelKpis.activeChefs30d)}
          sub="met een afgeronde dienst · 30 dagen"
        />
        <StatTile
          label="Actieve klanten"
          value={String(intelKpis.activeKlanten30d)}
          sub="met een dienst · 30 dagen"
        />
      </section>

      {/* Leaderboards */}
      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <LeaderboardCard
          title="Best verdienende chefs"
          icon="wallet"
          entries={leaders.topEarners}
          emptyHint="Nog geen afgeronde uren in deze periode."
        />
        <LeaderboardCard
          title="Grootste klanten"
          icon="building"
          entries={leaders.topClients}
          emptyHint="Nog geen omzet in deze periode."
        />
      </section>

      {/* Omzet per klant / per chef over de gekozen periode */}
      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <BreakdownTable
          title="Omzet per klant"
          rows={clientBreakdown}
          empty="Nog geen omzet in deze periode."
        />
        <BreakdownTable
          title="Omzet per chef"
          rows={chefBreakdown}
          empty="Nog geen afgeronde uren in deze periode."
        />
      </section>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: EntityRevenue[];
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-900">{r.name}</p>
                <p className="text-[11px] text-ink-500">
                  {r.detail} · marge {formatEuro(r.marginCents)}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm text-ink-900">
                {formatEuro(r.revenueCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangePill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] ${
        active
          ? "bg-burgundy text-white"
          : "border border-ink-200 text-ink-700 hover:border-burgundy hover:text-burgundy"
      }`}
    >
      {children}
    </Link>
  );
}

function ChartCard({
  title,
  headline,
  sub,
  children,
}: {
  title: string;
  headline: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{headline}</p>
      <p className="text-xs text-ink-500">{sub}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{value}</p>
      <p className="text-xs text-ink-500">{sub}</p>
    </div>
  );
}
