/**
 * KPI "profitability cockpit" tools (AI audit Wave 1) — owner-only read tools that answer
 * the money/health questions the dashboard already computes but the AI couldn't ask:
 * loss-making clients, unbilled hours, signoff backlog, platform trend, at-risk chefs.
 * Each wraps a read-model in src/lib/ai/read-model/kpi.ts (which reuses tested domain fns).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import {
  atRiskChefs,
  lossMakingClients,
  platformKpiTrend,
  signoffBacklog,
  unbilledByClient,
} from "@/lib/ai/read-model/kpi";
import { formatEuro } from "@/lib/hours-labels";

export const clientsLossMaking = defineTool({
  name: "clients.loss_making",
  title: "Verlieslatende klanten",
  description:
    "De klanten die over een periode (standaard 30 dagen) een NEGATIEVE marge draaien — omzet, marge (EUR) en een korte toelichting, meest-verlieslatend eerst. Voor 'welke klanten kosten me geld / waar verlies ik op'. Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ rangeDays: z.number().int().min(7).max(365).optional() }),
  run: async (input) => {
    const data = await lossMakingClients(input.rangeDays ?? 30);
    const summary =
      data.count === 0
        ? `Geen verlieslatende klanten in de afgelopen ${data.rangeDays} dagen.`
        : `${data.count} verlieslatende klant(en) (${data.rangeDays}d): ${data.clients
            .slice(0, 5)
            .map((c) => `${c.name} (${formatEuro(c.marginEur * 100)})`)
            .join(", ")}.`;
    return { data, summary };
  },
});

export const invoicingUnbilled = defineTool({
  name: "invoicing.unbilled",
  title: "Nog te factureren uren",
  description:
    "Goedgekeurde uren die nog NIET gefactureerd zijn, per klant: aantal uren + bedrag (EUR, ex btw) + oudste dienst. Voor 'hoeveel kan ik nog factureren / welke klant heeft uren klaarstaan'. Read-only.",
  risk: "read",
  permission: { resource: "invoices", action: "read" },
  input: z.object({}),
  run: async () => {
    const data = await unbilledByClient();
    const summary =
      data.count === 0
        ? "Alles is gefactureerd — geen openstaande goedgekeurde uren."
        : `${formatEuro(data.totalEur * 100)} te factureren over ${data.count} klant(en): ${data.clients
            .slice(0, 5)
            .map((c) => `${c.name} (${formatEuro(c.amountEur * 100)})`)
            .join(", ")}.`;
    return { data, summary };
  },
});

export const clientsSignoffBacklog = defineTool({
  name: "clients.signoff_backlog",
  title: "Klanten die uren niet aftekenen",
  description:
    "Klanten met uurbriefjes die op HUN handtekening wachten (ingediend, nog niet getekend) — aantal + hoe lang de oudste al wacht, meeste eerst. Voor 'welke klanten tekenen niet af / waar blijven uren hangen'. Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({}),
  run: async () => {
    const data = await signoffBacklog();
    const summary =
      data.count === 0
        ? "Geen openstaande handtekeningen — alle ingediende uren zijn getekend."
        : `${data.totalPending} uurbriefje(s) wachten op handtekening bij ${data.count} klant(en): ${data.clients
            .slice(0, 5)
            .map((c) => `${c.name} (${c.pending}${c.oldestWaitingDays != null ? `, ${c.oldestWaitingDays}d` : ""})`)
            .join(", ")}.`;
    return { data, summary };
  },
});

export const reportsPlatformKpi = defineTool({
  name: "reports.platform_kpi",
  title: "Platform-KPI trend",
  description:
    "De omzet-, marge- en bezettingstrend over de laatste weken of maanden, met opvallende uitschieters (≥30% stijging/daling). Voor 'hoe ontwikkelt mijn omzet/marge zich / marge deze maand vs vorige'. Geeft cijfers terug (geen PDF — gebruik reports.business_kpi voor een rapport). Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ bucket: z.enum(["week", "month"]).optional() }),
  run: async (input) => {
    const data = await platformKpiTrend(input.bucket ?? "month");
    const last = data.points[data.points.length - 1];
    const swing = data.marginSwing
      ? ` Marge ${data.marginSwing.direction === "up" ? "+" : "−"}${data.marginSwing.pct}% t.o.v. de vorige ${data.bucket === "week" ? "week" : "maand"}.`
      : "";
    const summary = last
      ? `Laatste ${data.bucket === "week" ? "week" : "maand"} (${last.label}): omzet ${formatEuro(last.revenueEur * 100)}, marge ${formatEuro(last.marginEur * 100)}.${swing}`
      : "Nog geen trenddata beschikbaar.";
    return { data, summary };
  },
});

export const chefsAtRisk = defineTool({
  name: "chefs.at_risk",
  title: "Chefs met afhaak-risico",
  description:
    "Goede chefs die stil gevallen zijn: een afgerond trackrecord maar al langere tijd niet ingezet — naam, dagen sinds laatste dienst, aantal afgeronde diensten, langst-inactief eerst. Voor 'welke chefs dreigen af te haken / wie moet ik reactiveren'. Read-only.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({}),
  run: async () => {
    const data = await atRiskChefs();
    const summary =
      data.count === 0
        ? "Geen chefs met verhoogd afhaak-risico — iedereen met historie is recent ingezet."
        : `${data.count} chef(s) met afhaak-risico: ${data.chefs
            .slice(0, 5)
            .map((c) => `${c.name} (${c.daysSinceLastShift}d stil)`)
            .join(", ")}.`;
    return { data, summary };
  },
});
