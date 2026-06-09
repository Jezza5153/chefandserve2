/**
 * intake.list — the intake inbox (new/awaiting-triage chef applications + klant requests).
 * Read-only, owner-gated (inbox.read).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { intakeInboxForAi } from "@/lib/ai/read-model/intake";

export const intakeList = defineTool({
  name: "intake.list",
  title: "Intake-inbox (nieuwe aanmeldingen)",
  description:
    "De intake-inbox: nieuwe en nog-niet-afgehandelde aanmeldingen die op triage wachten — chefs die zich aanmelden (naam · gewenste rol · ervaring · plaats) én klanten die zich melden (bedrijf · contact · gevraagde rol · wanneer · aantal). Voor 'wat staat er in de inbox / welke nieuwe sollicitaties of klant-aanvragen wachten op mij?'. Read-only.",
  risk: "read",
  permission: { resource: "inbox", action: "read" },
  input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  run: async (input) => {
    const d = await intakeInboxForAi({ limit: input.limit ?? 15 });
    return {
      data: d,
      summary:
        d.totaal === 0
          ? "De intake-inbox is leeg — geen openstaande aanmeldingen."
          : `${d.totaal} openstaande aanmelding(en): ${d.chefs.length} chef(s) + ${d.klanten.length} klant(en).`,
    };
  },
});
