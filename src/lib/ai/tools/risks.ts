/**
 * risks.scan — proactive intelligence: a forward-looking scan of "wat kan er deze week misgaan",
 * severity-sorted. Read-only. The agent can surface this on demand ("waar moet ik op letten?") and
 * it also feeds the morning dagstart.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { scanRisksForAi } from "@/lib/ai/read-model/risks";

export const risksScan = defineTool({
  name: "risks.scan",
  title: "Risico-radar",
  description:
    "Een vooruitblik op wat er deze week kan misgaan: onderbezette diensten binnenkort (nog niemand bevestigd), ingeroosterde chefs met een document dat bijna verloopt (kunnen straks niet werken), en vastgelopen uren (klant tekent niet / chef dient niet in). Gesorteerd op ernst (hoog/middel). Voor 'wat zijn de risico's / waar moet ik op letten / wat kan er misgaan?'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const { risks, count } = await scanRisksForAi(new Date());
    const high = risks.filter((r) => r.ernst === "hoog").length;
    return {
      data: { count, risks },
      summary:
        count === 0
          ? "Geen opvallende risico's — alles ziet er rustig uit. 👍"
          : `${count} risico('s)${high > 0 ? ` — ⚠ ${high} met hoge urgentie` : ""}: ${risks.map((r) => r.soort).join(", ")}.`,
    };
  },
});
