/**
 * Demand-forecast tool — forward staffing outlook. "Waar kom ik de komende weken chefs tekort?"
 * Read-only; counts per role + ISO-week, no PII. Wraps buildDemandForecast.
 */
import { z } from "zod";

import { buildDemandForecast } from "@/lib/ai/read-model/demand-forecast";
import { defineTool } from "@/lib/ai/tools/registry";

export const demandForecast = defineTool({
  name: "demand.forecast",
  title: "Vraag & bezetting vooruit",
  description:
    "Vooruitblik op de bezetting: waar kom ik de KOMENDE WEKEN chefs tekort? Telt de openstaande plekken (headcount − bevestigde plaatsingen) over álle aankomende diensten, gegroepeerd per ISO-week én rol — zodat je op tijd kunt werven of bijsturen (bv. 'week 28: 4 sous-chefs tekort'). Optioneel `weeks` (default 6, max 26). Read-only, alleen aantallen per rol/week — geen chef- of klantgegevens.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({ weeks: z.number().int().min(1).max(26).optional() }),
  run: async (input) => {
    const f = await buildDemandForecast(new Date(), input.weeks ?? 6);
    if (f.totalOpen === 0) {
      return {
        data: f,
        summary: `Geen openstaande plekken in de komende ${f.weeks} weken — de bezetting is rond. 👍`,
      };
    }
    const top = f.shortfalls
      .slice(0, 5)
      .map((s) => `week ${s.weekNo}: ${s.open}× ${s.role}`)
      .join(", ");
    return {
      data: f,
      summary: `${f.totalOpen} openstaande plek(ken) in de komende ${f.weeks} weken. Grootste tekorten: ${top}${f.shortfalls.length > 5 ? " …" : ""}.`,
    };
  },
});
