/**
 * chef-trends — KPI-2. Pure trend layer for the Chef 360 page, built ENTIRELY from
 * chef_metrics_daily snapshot rows (KPI-1). No DB, no fabrication: sparklines are
 * weekly SUMs, deltas route through the shared noise guard (a 1→2 blip never shows a
 * confident arrow), and "churn risk" is a deterministic, explainable label derived
 * from real signals (idle days + cancellation slope + acceptance) — never a magic score.
 *
 * The Chef 360 page calls buildChefTrends(getChefDailySeries(id, 90)) and renders the
 * result ALONGSIDE the existing point-in-time numbers (chef-history.ts). The sparkline
 * is suppressed when there isn't ≥2 weeks of history to avoid a misleading single bar.
 */
import {
  bucketByWeek,
  periodDelta,
  weightedAvg,
  windowSum,
  type ChefMetricsDaily,
  type PeriodDelta,
} from "@/lib/domain/metrics-history";

export type { PeriodDelta };

export type ChurnRisk = {
  /** none = too little signal · low = recently active · watch / elevated = attention. */
  level: "none" | "low" | "watch" | "elevated";
  /** Deterministic Dutch reasons — every one is a real, checkable signal. */
  reasons: string[];
};

export type ChefTrends = {
  /** ≥ 2 weeks of snapshot history — gate for showing the sparkline. */
  hasEnoughHistory: boolean;
  weeks: number;
  hoursSparkline: number[]; // weekly hours (whole)
  marginSparkline: number[]; // weekly margin (euro, whole)
  shiftsSparkline: number[]; // weekly completed shifts
  hoursDelta: PeriodDelta; // this 7d vs prior 7d (whole hours)
  marginDelta: PeriodDelta; // euro
  shiftsDelta: PeriodDelta; // count
  ratingAvg28d: number | null;
  acceptanceRate28d: number | null;
  daysSinceLastWorked: number | null;
  churn: ChurnRisk;
};

const SEVERITY: Record<ChurnRisk["level"], number> = { none: 0, low: 1, watch: 2, elevated: 3 };
const worse = (a: ChurnRisk["level"], b: ChurnRisk["level"]) => (SEVERITY[a] >= SEVERITY[b] ? a : b);

function midnightUTC(d: Date): number {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}
function daysBetween(isoDate: string, today: Date): number {
  return Math.floor((midnightUTC(today) - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86_400_000);
}

export function buildChefTrends(series: ChefMetricsDaily[], today: Date = new Date()): ChefTrends {
  const WEEKS = 8;

  // History gate: earliest snapshot at least 14 days old (enough span for a real sparkline).
  const earliest = series[0]?.snapshotDate;
  const hasEnoughHistory = earliest != null && daysBetween(earliest, today) >= 14;

  const hoursSparkline = bucketByWeek(series, (r) => r.hoursWorkedMinutes, WEEKS, today).map((m) =>
    Math.round(m / 60),
  );
  const marginSparkline = bucketByWeek(series, (r) => r.marginCents, WEEKS, today).map((c) =>
    Math.round(c / 100),
  );
  const shiftsSparkline = bucketByWeek(series, (r) => r.completedShifts, WEEKS, today);

  const round = (d: PeriodDelta): PeriodDelta => ({
    ...d,
    thisPeriod: Math.round(d.thisPeriod),
    prevPeriod: Math.round(d.prevPeriod),
    diff: Math.round(d.diff),
  });
  const hoursDelta = round(periodDelta(series, (r) => r.hoursWorkedMinutes / 60, today));
  const marginDelta = round(periodDelta(series, (r) => r.marginCents / 100, today));
  const shiftsDelta = periodDelta(series, (r) => r.completedShifts, today);

  const ratingAvg28d = weightedAvg(series, (r) => r.ratingSum, (r) => r.ratingCount, 28, today);

  const accepted28 = windowSum(series, (r) => r.proposalsAccepted, 28, today);
  const rejected28 = windowSum(series, (r) => r.proposalsRejected, 28, today);
  const proposals28 = accepted28 + rejected28;
  const acceptanceRate28d = proposals28 > 0 ? accepted28 / proposals28 : null;

  // last worked = most recent snapshot day with real work (series is ascending).
  const workedDays = series.filter((r) => r.completedShifts > 0 || r.hoursWorkedMinutes > 0);
  const lastWorked = workedDays.length ? workedDays[workedDays.length - 1].snapshotDate : null;
  const daysSinceLastWorked = lastWorked != null ? daysBetween(lastWorked, today) : null;

  // cancellation slope: recent 28d vs the prior 28d.
  const cancRecent = windowSum(series, (r) => r.cancellations, 28, today);
  const cancPrev = windowSum(series, (r) => r.cancellations, 56, today) - cancRecent;

  // ---- churn risk: deterministic, explainable ----
  const reasons: string[] = [];
  let level: ChurnRisk["level"] = "none";

  if (!hasEnoughHistory && daysSinceLastWorked == null) {
    return {
      hasEnoughHistory,
      weeks: WEEKS,
      hoursSparkline,
      marginSparkline,
      shiftsSparkline,
      hoursDelta,
      marginDelta,
      shiftsDelta,
      ratingAvg28d,
      acceptanceRate28d,
      daysSinceLastWorked,
      churn: { level: "none", reasons: ["te weinig historie"] },
    };
  }

  level = "low";
  if (daysSinceLastWorked != null) {
    if (daysSinceLastWorked > 60) {
      level = worse(level, "elevated");
      reasons.push(`${daysSinceLastWorked} dagen niet gewerkt`);
    } else if (daysSinceLastWorked >= 30) {
      level = worse(level, "watch");
      reasons.push(`${daysSinceLastWorked} dagen niet gewerkt`);
    }
  }
  if (cancRecent >= 5) {
    level = worse(level, "elevated");
    reasons.push(`${cancRecent} annuleringen recent`);
  } else if (cancRecent >= 2 && cancRecent > cancPrev) {
    level = worse(level, "watch");
    reasons.push("annuleringen lopen op");
  }
  if (acceptanceRate28d != null && proposals28 >= 5 && acceptanceRate28d < 0.5) {
    level = worse(level, "watch");
    reasons.push(`lage acceptatie (${Math.round(acceptanceRate28d * 100)}%)`);
  }
  if (reasons.length === 0) reasons.push("recent actief, geen signalen");

  return {
    hasEnoughHistory,
    weeks: WEEKS,
    hoursSparkline,
    marginSparkline,
    shiftsSparkline,
    hoursDelta,
    marginDelta,
    shiftsDelta,
    ratingAvg28d,
    acceptanceRate28d,
    daysSinceLastWorked,
    churn: { level, reasons },
  };
}
