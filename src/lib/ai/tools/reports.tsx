/**
 * reports.business_kpi — generate a polished PDF "management dashboard" (KPI overview with a
 * 6-month revenue/margin chart + plain-language explanation) and return a download link.
 * Read-only: it reads data + produces a private, presigned download (no business mutation).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { generateKpiReport, generateChefsReport, generateClientsReport } from "@/lib/ai/reports/render";

export const reportsBusinessKpi = defineTool({
  name: "reports.business_kpi",
  title: "Bedrijfsrapport (PDF)",
  description:
    "Genereer een nette PDF-bedrijfsrapportage (KPI-dashboard): omzet & marge (deze maand + YTD + een grafiek van de laatste 6 maanden), bezetting, actieve chefs en operationele aandachtspunten — mét grafiek en uitleg in gewone taal. Geeft een downloadlink terug (24 uur geldig). Voor 'maak een rapport / KPI-overzicht / managementrapportage in PDF / stuur me de cijfers als rapport'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const res = await generateKpiReport(new Date());
    if (!res.ok) throw new Error(res.error);
    return {
      data: { url: res.url, format: "pdf" },
      summary: `Je KPI-bedrijfsrapport (PDF) staat klaar — downloadlink (24u geldig): ${res.url}`,
    };
  },
});

export const reportsChefs = defineTool({
  name: "reports.chefs",
  title: "Chef-rapport (PDF)",
  description:
    "Genereer een nette PDF-rapportage over de chefs: per chef de omzet, marge en inzet (uren · diensten) over de gekozen periode (standaard 90 dagen), met een top-chefs-grafiek, een volledige tabel en uitleg in gewone taal. Geeft een downloadlink terug (24u geldig). Voor 'maak me een rapport over de chefs / chef-prestaties in PDF'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ rangeDays: z.number().int().min(7).max(365).optional() }),
  run: async (input) => {
    const res = await generateChefsReport(new Date(), input.rangeDays ?? 90);
    if (!res.ok) throw new Error(res.error);
    return {
      data: { url: res.url, format: "pdf" },
      summary: `Je chef-rapport (PDF) staat klaar — downloadlink (24u geldig): ${res.url}`,
    };
  },
});

export const reportsClients = defineTool({
  name: "reports.clients",
  title: "Klant-rapport (PDF)",
  description:
    "Genereer een nette PDF-rapportage over de klanten: per klant de omzet, marge en bezetting over de gekozen periode (standaard 90 dagen), met een top-klanten-grafiek, een volledige tabel en uitleg in gewone taal. Geeft een downloadlink terug (24u geldig). Voor 'maak me een rapport over de klanten / welke hotels brengen het meest op in PDF'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ rangeDays: z.number().int().min(7).max(365).optional() }),
  run: async (input) => {
    const res = await generateClientsReport(new Date(), input.rangeDays ?? 90);
    if (!res.ok) throw new Error(res.error);
    return {
      data: { url: res.url, format: "pdf" },
      summary: `Je klant-rapport (PDF) staat klaar — downloadlink (24u geldig): ${res.url}`,
    };
  },
});
