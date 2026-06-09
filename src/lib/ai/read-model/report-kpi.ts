/**
 * Business-KPI report data — the numbers behind the PDF "management dashboard". Reuses the live
 * business snapshot (current revenue/margin/occupancy/chefs/ops) and adds a 6-month revenue +
 * margin time-series (computed directly from shift_hours, so it needs no metrics worker). Pure
 * read; every figure traces to a query.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { getBusinessSnapshot, type BusinessSnapshot } from "@/lib/ai/read-model/business";

const MONTH_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export type KpiMonth = { key: string; label: string; revenueCents: number; marginCents: number; rows: number };

export type KpiReportData = {
  generatedAtLabel: string;
  snapshot: BusinessSnapshot;
  months: KpiMonth[];
};

export async function buildKpiReportData(now: Date): Promise<KpiReportData> {
  const snapshot = await getBusinessSnapshot();

  // Last 6 calendar months (incl. current), revenue + margin from logged hours (Amsterdam months).
  const since = new Date(now);
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const res = await db.execute(sql`
    SELECT to_char(date_trunc('month', started_at AT TIME ZONE 'Europe/Amsterdam'), 'YYYY-MM') AS k,
           COALESCE(SUM(client_rate_cents * worked_minutes / 60.0), 0)::bigint AS revenue_cents,
           COALESCE(SUM((client_rate_cents - chef_rate_cents) * worked_minutes / 60.0), 0)::bigint AS margin_cents,
           COUNT(*)::int AS rows
    FROM shift_hours
    WHERE started_at >= ${since.toISOString()} AND status <> 'void'
    GROUP BY 1
    ORDER BY 1
  `);
  const raw = ((res as { rows?: unknown[] }).rows ?? []) as Array<{
    k: string;
    revenue_cents: string | number;
    margin_cents: string | number;
    rows: number;
  }>;
  const byKey = new Map<string, KpiMonth>();
  for (const r of raw) {
    const [y, m] = String(r.k).split("-");
    byKey.set(r.k, {
      key: r.k,
      label: `${MONTH_NL[Number(m) - 1]} '${y.slice(2)}`,
      revenueCents: Number(r.revenue_cents),
      marginCents: Number(r.margin_cents),
      rows: Number(r.rows),
    });
  }

  // Fill the full 6-month axis (zero-fill empty months so the chart has a stable x-axis).
  const months: KpiMonth[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(byKey.get(key) ?? { key, label: `${MONTH_NL[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, revenueCents: 0, marginCents: 0, rows: 0 });
  }

  return {
    generatedAtLabel: now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    snapshot,
    months,
  };
}
