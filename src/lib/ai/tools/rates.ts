/**
 * rates.card — what a role should cost and earn per hour.
 *
 * The assistant creates and edits shifts, so it needs the same norm the admin form uses;
 * otherwise it either leaves rates empty or invents them, and an invented rate on a real
 * shift becomes a real invoice line. It also lets the owner ask the question directly
 * ("wat rekenen we voor een sous-chef?"), which had no answer anywhere before.
 *
 * Read-only. No klant or chef data — these are our own list prices.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { getTariefkaart, normMarge } from "@/lib/domain/rate-card";
import { formatChefRole } from "@/lib/labels";

const euro = (c: number) => `€ ${(c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ratesCard = defineTool({
  name: "rates.card",
  title: "Standaardtarieven per functie",
  description:
    'De standaardtarieven per functie: wat we een klant per uur rekenen en wat de chef per uur verdient. Voor "wat rekenen we voor een sous-chef", "wat is ons tarief voor bediening", "hoeveel marge zit er op een commis", en om te controleren of een tarief op een dienst normaal is. Let op: dit zijn NORMEN, geen vaste prijzen — per klant of dienst mag ervan afgeweken worden, en de kale uurtarieven staan hier LOS van eventuele toeslagen voor nacht, weekend of spoed. Read-only.',
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({
    rol: z.string().optional().describe("Eén functie (bv. sous_chef). Leeg = de hele kaart."),
  }),
  run: async (input) => {
    const kaart = await getTariefkaart();
    const rollen = Object.entries(kaart) as [string, { klantCents: number; chefCents: number }][];

    if (rollen.length === 0) {
      return {
        data: { ingesteld: false, tarieven: [] },
        summary:
          "Er zijn nog geen standaardtarieven ingesteld. Zeg dat eerlijk — verzin geen bedragen — en wijs naar /admin/business/tarieven om ze vast te leggen.",
      };
    }

    const vorm = (rol: string, n: { klantCents: number; chefCents: number }) => ({
      rol,
      functie: formatChefRole(rol),
      klantPerUurCents: n.klantCents,
      chefPerUurCents: n.chefCents,
      margePct: normMarge(n),
    });

    if (input.rol) {
      const treffer = rollen.find(([r]) => r === input.rol);
      if (!treffer) {
        return {
          data: { ingesteld: true, gevraagdeRol: input.rol, tarieven: rollen.map(([r, n]) => vorm(r, n)) },
          summary: `Voor ${formatChefRole(input.rol)} is geen standaardtarief vastgelegd. Noem geen bedrag; zeg welke functies wél een norm hebben.`,
        };
      }
      const [rol, n] = treffer;
      return {
        data: { ingesteld: true, tarieven: [vorm(rol, n)] },
        summary: `${formatChefRole(rol)}: klant ${euro(n.klantCents)} per uur, chef ${euro(n.chefCents)} per uur (marge ${normMarge(n)}%). Dit is de norm — per klant kan er een andere afspraak gelden.`,
      };
    }

    const alle = rollen.map(([r, n]) => vorm(r, n));
    return {
      data: { ingesteld: true, tarieven: alle },
      summary: `Standaardtarieven voor ${alle.length} ${alle.length === 1 ? "functie" : "functies"}, bv. ${alle
        .slice(0, 3)
        .map((t) => `${t.functie} ${euro(t.klantPerUurCents)}/${euro(t.chefPerUurCents)}`)
        .join(", ")}. Het zijn normen — per klant kan er een andere afspraak gelden, en toeslagen komen er nog bovenop.`,
    };
  },
});
