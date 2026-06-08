/**
 * briefing.daily — the owner's "dagstart" on demand: a recap of yesterday + today's
 * forecast, exactly what the proactive morning push delivers (read-model/briefing.ts),
 * but pulled when Maarten asks. Read-only, no side effects.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { buildDailyBriefing } from "@/lib/ai/read-model/briefing";

export const briefingDaily = defineTool({
  name: "briefing.daily",
  title: "Dagstart",
  description:
    "Je dagstart in één overzicht: een recap van GISTEREN (gedraaide diensten, uren die nog niet rond zijn — hotel moet nog tekenen / chef moet nog indienen, en nieuwe opmerkingen van hotels) plus de vooruitblik van VANDAAG (geplande diensten + open plekken, uren die op jouw goedkeuring wachten, en documenten die binnenkort verlopen). Read-only. Gebruik bij 'geef me mijn dagstart', 'hoe staan we er vanochtend voor', of 'wat is er gisteren blijven liggen'.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const b = await buildDailyBriefing(new Date());
    return { data: b.data, summary: b.text };
  },
});
