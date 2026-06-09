/**
 * Chef team report data — "maak me een rapport over de chefs". Per-chef revenue/margin/hours/
 * shifts over a window (reuses the tested getChefRevenueBreakdown over the metrics snapshots) +
 * team totals. Pure read. (Populated by the daily metrics worker; empty windows degrade to a
 * clean "geen data" report.)
 */
import { getChefRevenueBreakdown, type EntityRevenue } from "@/lib/domain/reporting";

export type ChefsReportData = {
  generatedAtLabel: string;
  rangeDays: number;
  chefs: EntityRevenue[];
  totalRevenueCents: number;
  totalMarginCents: number;
};

export async function buildChefsReportData(now: Date, rangeDays = 90): Promise<ChefsReportData> {
  const chefs = await getChefRevenueBreakdown(rangeDays, { now, limit: 25 });
  return {
    generatedAtLabel: now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    rangeDays,
    chefs,
    totalRevenueCents: chefs.reduce((sum, c) => sum + c.revenueCents, 0),
    totalMarginCents: chefs.reduce((sum, c) => sum + c.marginCents, 0),
  };
}
