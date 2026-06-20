/**
 * chefs.update_contact (AI reality-audit gap #6) — "zet Daniel z'n nummer op 06-…", "z'n
 * stad klopt niet". Corrects the SAFE basics (phone, name, city) the owner can fix directly.
 * risk 'self': the owner asked explicitly, so it just does it (no confirm friction) — but
 * it's audited and scoped (no BSN/IBAN/ID, no vakniveau/rate). One verb, one function.
 */
import { z } from "zod";

import { updateChefContact } from "@/lib/domain/chef-edit";
import { defineTool } from "@/lib/ai/tools/registry";

export const chefsUpdateContact = defineTool({
  name: "chefs.update_contact",
  title: "Chef-contact bijwerken",
  description:
    "Corrigeer de basisgegevens van een chef: telefoonnummer, naam of stad. Geef chefId (via chefs.find of het id van de huidige pagina) + alleen de velden die wijzigen. NIET voor gevoelige gegevens (BSN/IBAN/ID), vakniveau of tarief — dat gaat anders. Doet de wijziging direct.",
  risk: "self",
  permission: { resource: "chefs", action: "write" },
  input: z.object({
    chefId: z.string().min(1, "chefId is verplicht (chefs.find of de huidige pagina)"),
    phone: z.string().max(40).optional(),
    fullName: z.string().max(120).optional(),
    city: z.string().max(80).optional(),
  }),
  run: async (input, ctx) => {
    const res = await updateChefContact({
      chefId: input.chefId,
      editorUserId: ctx.actor.requestedByUserId,
      phone: input.phone,
      fullName: input.fullName,
      city: input.city,
    });
    if (!res.ok) return { data: res, summary: `Niet gelukt: ${res.error}` };
    return {
      data: res,
      summary: res.changed.length ? `Chef bijgewerkt (${res.changed.join(", ")}).` : "Geen wijzigingen — stond al zo.",
    };
  },
});
