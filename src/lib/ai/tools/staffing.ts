/**
 * Staffing tools — the assistant's day-to-day ops eyes:
 *  - planner.cockpit   : "wat heeft vandaag mijn aandacht" (intake + urgent queue + top match)
 *  - shifts.suggest_chefs : "welke chefs passen bij deze dienst" (ranked, with reasons)
 * Both read-only, wrapping the existing planner-intel + matching engines.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { plannerCockpit, suggestChefsForShift } from "@/lib/ai/read-model/staffing";

export const plannerCockpitTool = defineTool({
  name: "planner.cockpit",
  title: "Wat heeft vandaag mijn aandacht",
  description:
    "De dagelijkse actie-wachtrij: nieuwe intake (chefs + klanten), geaccepteerde-maar-nog-niet-bevestigde plaatsingen, open plekken binnen 48 uur en binnen 7 dagen, plus de meest urgente open dienst met voorgestelde chefs. Read-only.",
  risk: "read",
  permission: { resource: "planning", action: "read" },
  input: z.object({}),
  run: async () => {
    const data = await plannerCockpit(new Date());
    return {
      data,
      summary: `Intake: ${data.intake.total} nieuw · ${data.acceptedUnconfirmed} te bevestigen · ${data.open48hSlots} open plek(ken) binnen 48u · ${data.open7dCount} dienst(en) open deze week.`,
    };
  },
});

export const shiftsSuggestChefs = defineTool({
  name: "shifts.suggest_chefs",
  title: "Beste chefs voor een dienst",
  description:
    "De best passende chefs voor één open dienst, gerangschikt met score + redenen + waarschuwingen (vakniveau, segment, ervaring, beschikbaarheid, afstand). Gebruik dit vóór placements.propose. Gebruik shifts.find voor het shiftId.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({
    shiftId: z.string().min(1, "shiftId is verplicht"),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  run: async (input) => {
    const matches = await suggestChefsForShift(input.shiftId, input.limit ?? 5);
    if (matches === null) throw new Error("deze dienst bestaat niet (meer)");
    return {
      data: { count: matches.length, matches },
      summary:
        matches.length === 0
          ? "Geen passende chefs gevonden voor deze dienst."
          : `${matches.length} chef(s) voorgesteld — beste: ${matches[0].chefName} (score ${matches[0].score}).`,
    };
  },
});
