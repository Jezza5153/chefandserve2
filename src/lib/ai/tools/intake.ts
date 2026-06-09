/**
 * intake.list — the intake inbox (new/awaiting-triage chef applications + klant requests).
 * Read-only, owner-gated (inbox.read).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { intakeInboxForAi } from "@/lib/ai/read-model/intake";
import { convertChefSubmission, convertClientSubmission } from "@/lib/domain/conversions";

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

export const intakeConvert = defineTool({
  name: "intake.convert",
  title: "Aanmelding omzetten",
  description:
    "Zet een intake-aanmelding om naar een echt profiel: een chef-aanmelding → chef-record, een klant-aanmelding → klant-record. Idempotent (al omgezet = geen dubbele). Dit is de start van de onboarding — uitnodigen voor het portaal is een aparte stap. Voor 'zet deze sollicitatie om naar een chef / maak een klant aan van aanvraag X'. Gebruik intake.list voor het submissionId.",
  risk: "outbound",
  permission: { resource: "inbox", action: "triage" },
  input: z.object({
    submissionId: z.string().min(1, "submissionId is verplicht"),
    kind: z.enum(["chef", "client"]),
  }),
  describeAction: (i) => `Intake-aanmelding ${i.submissionId} omzetten naar een ${i.kind === "chef" ? "chef" : "klant"}-profiel.`,
  run: async (input, ctx) => {
    try {
      if (input.kind === "chef") {
        const { chefId } = await convertChefSubmission(input.submissionId, ctx.actor.requestedByUserId);
        return { data: { chefId }, summary: "Aanmelding omgezet naar een chef-profiel. (Uitnodigen voor het portaal is de volgende stap.)" };
      }
      const { clientId } = await convertClientSubmission(input.submissionId, ctx.actor.requestedByUserId);
      return { data: { clientId }, summary: "Aanmelding omgezet naar een klant-profiel. (Uitnodigen voor het portaal is de volgende stap.)" };
    } catch (e) {
      throw new Error(e instanceof Error && /not found/i.test(e.message) ? "deze aanmelding bestaat niet (meer)" : "kon de aanmelding niet omzetten");
    }
  },
});
