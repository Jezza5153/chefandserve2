/**
 * reports.business_kpi — generate a polished PDF "management dashboard" (KPI overview with a
 * 6-month revenue/margin chart + plain-language explanation) and return a download link.
 * Read-only: it reads data + produces a private, presigned download (no business mutation).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { generateKpiReport } from "@/lib/ai/reports/render";

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
