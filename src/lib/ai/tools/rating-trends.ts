/**
 * Rating-trends tool — the fleet-wide quality radar. chefs.feedback = one chef's ratings;
 * THIS answers "waar moet ik op letten qua kwaliteit?" across everyone: declining chefs +
 * repeated-low chef↔klant pairs. Internal-only (ratings intern V1). Read-only.
 */
import { z } from "zod";

import { sweepRatingTrends } from "@/lib/ai/read-model/rating-trends";
import { defineTool } from "@/lib/ai/tools/registry";

export const ratingsTrends = defineTool({
  name: "ratings.trends",
  title: "Beoordelings-trends (kwaliteitsradar)",
  description:
    "Kwaliteitsradar over ÁLLE chefs (laatste 90 dagen): welke chefs DALEN in hun beoordelingen (recente 30d vs de 60d ervoor), en welke chef↔klant-combinaties kregen herhaald lage sterren (≥2× ≤3★) — 'Marco kreeg 2× ≤3★ bij Okura, let op bij de volgende match'. Gebruik dit voor 'waar moet ik op letten qua kwaliteit / welke chefs gaan achteruit'. Voor de beoordelingen van één specifieke chef: chefs.feedback. Intern — alleen jij ziet ratings. Read-only.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({}),
  run: async () => {
    const t = await sweepRatingTrends(new Date());
    if (t.totalRatings === 0) {
      return { data: t, summary: "Nog geen beoordelingen in de laatste 90 dagen — geen trends te zien." };
    }
    const parts: string[] = [];
    if (t.declining.length) {
      parts.push(
        `${t.declining.length} chef(s) dalend: ${t.declining
          .slice(0, 3)
          .map((d) => `${d.chef} (${d.avgPrior}→${d.avgRecent}★, ${d.count90d} beoordelingen)`)
          .join(", ")}${t.declining.length > 3 ? " …" : ""}`,
      );
    }
    if (t.repeatLowPairs.length) {
      parts.push(
        `${t.repeatLowPairs.length} herhaald-laag: ${t.repeatLowPairs
          .slice(0, 3)
          .map((p) => `${p.chef} ${p.lowCount}× ≤3★ bij ${p.client}`)
          .join(", ")}${t.repeatLowPairs.length > 3 ? " …" : ""}`,
      );
    }
    return {
      data: t,
      summary: parts.length
        ? `Kwaliteitsradar (${t.totalRatings} beoordelingen/90d): ${parts.join(" · ")}.`
        : `Geen aandachtspunten: ${t.totalRatings} beoordelingen in 90 dagen, niemand dalend, geen herhaald-lage combinaties. 👍`,
    };
  },
});
