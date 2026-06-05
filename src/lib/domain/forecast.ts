/**
 * forecast — KPI-5, DARK-LAUNCHED behind KPI_FORECAST_ENABLED (default off).
 *
 * NOT a statistical model — a deterministic, labelled PROJECTION from current state:
 *  - understaffingByRole: open slots (headcount − confirmed/completed placements) on
 *    shifts in the next 48h. Plain counting of the live roster.
 *  - churnRiskCount: chefs who worked in the last 120d but have now been idle > 30d.
 * The UI must label this a projection ("op basis van het huidige rooster"), never a
 * prediction. forecastEnabled() gates rendering; the page stays correct when off.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

export function forecastEnabled(): boolean {
  return process.env.KPI_FORECAST_ENABLED === "true";
}

function rows<T>(r: unknown): T[] {
  return Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);
}

export type Understaffing = { role: string; needed: number };
export type Forecast = {
  windowHours: number;
  understaffingByRole: Understaffing[];
  totalOpenSlots: number;
  churnRiskCount: number;
};

export async function getForecast(): Promise<Forecast> {
  const [openRes, churnRes] = await Promise.all([
    db.execute(sql`
      SELECT role_needed AS role, sum(open)::int AS needed
      FROM (
        SELECT s.role_needed,
          greatest(s.headcount - (SELECT count(*) FROM placements p WHERE p.shift_id = s.id AND p.status IN ('confirmed','completed')), 0)::int AS open
        FROM shifts s
        WHERE s.starts_at > now() AND s.starts_at <= now() + interval '48 hours' AND s.status NOT IN ('cancelled','completed')
      ) t GROUP BY role_needed HAVING sum(open) > 0 ORDER BY needed DESC
    `),
    db.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT chef_id, max(snapshot_date) AS last_worked
        FROM chef_metrics_daily
        WHERE snapshot_date >= (now()-interval '120 days')::date AND (hours_worked_minutes > 0 OR completed_shifts > 0)
        GROUP BY chef_id
      ) t WHERE last_worked < (now()-interval '30 days')::date
    `),
  ]);

  const understaffingByRole = rows<{ role: string; needed: number }>(openRes).map((r) => ({
    role: r.role,
    needed: Number(r.needed),
  }));
  const churn = rows<{ n: number }>(churnRes)[0];
  return {
    windowHours: 48,
    understaffingByRole,
    totalOpenSlots: understaffingByRole.reduce((a, r) => a + r.needed, 0),
    churnRiskCount: Number(churn?.n ?? 0),
  };
}
