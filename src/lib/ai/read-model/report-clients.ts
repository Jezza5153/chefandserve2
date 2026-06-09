/**
 * Klant report data — "rapport over mijn klanten / welke hotels brengen het meest op". Per-klant
 * revenue/margin + occupancy detail over a window (reuses getClientRevenueBreakdown over the
 * metrics snapshots) + totals. Pure read. Mirrors report-chefs.ts.
 */
import { getClientRevenueBreakdown, type EntityRevenue } from "@/lib/domain/reporting";

export type ClientsReportData = {
  generatedAtLabel: string;
  rangeDays: number;
  clients: EntityRevenue[];
  totalRevenueCents: number;
  totalMarginCents: number;
};

export async function buildClientsReportData(now: Date, rangeDays = 90): Promise<ClientsReportData> {
  const clients = await getClientRevenueBreakdown(rangeDays, { now, limit: 25 });
  return {
    generatedAtLabel: now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    rangeDays,
    clients,
    totalRevenueCents: clients.reduce((sum, c) => sum + c.revenueCents, 0),
    totalMarginCents: clients.reduce((sum, c) => sum + c.marginCents, 0),
  };
}
