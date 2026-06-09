/**
 * Intel tools for the owner assistant — PR-INTEL-P4. The assistant can now reason
 * over the whole intelligence layer: who a chef/klant is, and whether a pairing
 * fits. All READ (no confirmation), owner-gated via chefs.read / clients.read.
 * Wrap the intel read-models — no fabrication, every field observed/captured/
 * Maarten-written. Brain resolves names → ids with chefs.find / clients.find first.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { chefIntelForAi, clientIntelForAi, matchIntelForAi } from "@/lib/ai/read-model/intel";

export const chefsIntelSnapshot = defineTool({
  name: "chefs.intel_snapshot",
  title: "Chef intel-snapshot",
  description:
    "Het complete intel-beeld van één chef: Maarten's oordeel ('best ingezet voor' / risico / volgende actie), werkpatronen (drukste dag, dagdeel ontbijt/lunch/diner, rollen), verdiensten per klant + totaal/30d, wat de chef vaak afwijst, en hoe lang geleden hij werkte (reactivatie-signaal). Gebruik voor 'vertel me over chef X' of 'wie kan ik morgen bellen'. chefId via chefs.find.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefIntelForAi(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const reactivate =
      data.daysSinceLastWorked != null && data.daysSinceLastWorked >= 14
        ? ` — let op: ${data.daysSinceLastWorked} dagen niet gewerkt`
        : "";
    return { data, summary: `Intel-snapshot van de chef opgehaald${reactivate}.` };
  },
});

export const clientsIntelSnapshot = defineTool({
  name: "clients.intel_snapshot",
  title: "Klant intel-snapshot",
  description:
    "Het complete intel-beeld van één klant: Maarten's oordeel (beste chef-type / waar ze écht om geven / verborgen risico / volgende actie), boekingspatronen (drukste dag, rollen) en de vaste chefs. Gebruik voor 'vertel me over klant X' of 'welke klant vraagt aandacht'. clientId via clients.find.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ clientId: z.string().min(1, "clientId is verplicht") }),
  run: async (input) => {
    const data = await clientIntelForAi(input.clientId);
    if (!data) throw new Error("deze klant bestaat niet (meer)");
    return { data, summary: "Intel-snapshot van de klant opgehaald." };
  },
});

export const matchIntelLookup = defineTool({
  name: "match.intel",
  title: "Match-intel (chef × klant)",
  description:
    "Het volledige match-beeld voor één chef + klant samen: hebben ze eerder gewerkt (hoe vaak, laatste keer, klant-beoordeling, favoriet/geblokkeerd), de post-shift duimen, én Maarten's pair-notitie + de AI-samenvatting waarom het werkt of mis kan gaan. Gebruik om te beoordelen of een chef bij een klant past vóór een voorstel. chefId + clientId via chefs.find / clients.find.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    chefId: z.string().min(1, "chefId is verplicht"),
    clientId: z.string().min(1, "clientId is verplicht"),
  }),
  run: async (input) => {
    const data = await matchIntelForAi(input.chefId, input.clientId);
    const flags = `${data.favoriet ? " · favoriet" : ""}${data.geblokkeerd ? " · GEBLOKKEERD" : ""}`;
    return { data, summary: `${data.samengewerkt}× samengewerkt${flags}.` };
  },
});
