/**
 * chefs.momenten — verjaardagen, jubilea en mijlpalen voor de assistent.
 *
 * Exists because the owner asked "is er iemand jarig binnenkort" and the assistant
 * had NO tool that could see birthdays (they lived only on UI surfaces). Reads the
 * same domain function as the dashboard card and the briefing — one source, three
 * surfaces, no disagreement. INTERNAL: owner-side registry only.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { getPeopleMomentsDetailed } from "@/lib/domain/people-moments";

export const chefsMomenten = defineTool({
  name: "chefs.momenten",
  title: "Verjaardagen, jubilea en mijlpalen",
  description:
    'Wie is er binnenkort jarig, wie heeft een werkjubileum en wie nadert een mijlpaal (bijv. 100e dienst)? Voor "is er iemand jarig / wie moet ik feliciteren / speciale momenten deze maand". Standaard 14 dagen vooruit, maximaal 62. Read-only, intern.',
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    windowDays: z.number().int().min(1).max(62).optional().describe("Hoeveel dagen vooruit (standaard 14)."),
  }),
  run: async (input) => {
    const { moments, chefsWithDob, activeChefs } = await getPeopleMomentsDetailed({ windowDays: input.windowDays });
    // Honesty over emptiness: "nothing found" when NO chef has a birthdate is not an
    // answer — it's a data gap the owner can fix. Say so.
    const summary =
      moments.length > 0
        ? `${moments.length} moment(en) — eerstvolgende: ${moments[0]!.name} (${moments[0]!.label.toLowerCase()}).`
        : chefsWithDob === 0
          ? `Geen momenten — maar let op: van geen van de ${activeChefs} actieve chefs is een geboortedatum ingevuld. Vul die aan op de chefpagina's, dan kan ik dit wél beantwoorden.`
          : `Geen verjaardagen, jubilea of mijlpalen in deze periode (${chefsWithDob}/${activeChefs} chefs met geboortedatum bekend).`;
    return { data: { count: moments.length, moments, chefsWithDob, activeChefs }, summary };
  },
});
