/**
 * CHEF portal assistant tools — read-only, own-data-only. `permission: null` + `risk: "read"`
 * so they run immediately (no RBAC gate, no confirm); safety comes from the SCOPE: each tool
 * keys its query off `ctx.actor.subject.entityId` (the chef resolved from the session), never a
 * model-supplied id. A chef can only ever see their own diensten/uren/profiel.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import type { ToolContext } from "@/lib/ai/types";
import { chefMyShifts, chefMyHours, chefMyProfile } from "@/lib/ai/read-model/chef-self";

function requireChefId(ctx: ToolContext): string {
  if (ctx.actor.subject?.kind !== "chef" || !ctx.actor.subject.entityId) {
    throw new Error("Geen gekoppeld chef-profiel.");
  }
  return ctx.actor.subject.entityId;
}

export const chefMyShiftsTool = defineTool({
  name: "mijn.diensten",
  title: "Mijn diensten",
  description:
    "Jouw aankomende diensten: voorstellen die nog op jouw antwoord wachten, geaccepteerde/bevestigde diensten en je eerstvolgende dienst (klant, rol, wanneer, waar). Read-only — alleen jouw eigen diensten.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await chefMyShifts(requireChefId(ctx));
    const next = data.nextConfirmed;
    return {
      data,
      summary:
        `${data.proposals.length} voorstel(len) · ${data.confirmed.length} bevestigd/geaccepteerd.` +
        (next ? ` Eerstvolgende: ${next.client} (${next.role}) op ${next.when}.` : " Geen bevestigde dienst gepland."),
    };
  },
});

export const chefMyHoursTool = defineTool({
  name: "mijn.uren",
  title: "Mijn uren",
  description:
    "Jouw uren: welke uurbriefjes je nog moet invullen, welke zijn afgekeurd (actie nodig), en je geldoverzicht (te ontvangen / in controle / afgekeurd). Read-only — alleen jouw eigen uren.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await chefMyHours(requireChefId(ctx));
    return {
      data,
      summary:
        `${data.toLog.length} uurbriefje(s) in te vullen · ${data.rejected.length} afgekeurd · te ontvangen ${data.money.teOntvangen}.`,
    };
  },
});

export const chefMyProfileTool = defineTool({
  name: "mijn.profiel",
  title: "Mijn profiel & onboarding",
  description:
    "De status van jouw profiel en onboarding: vakniveau, stad, of je onboarding af is, en wat er nog ontbreekt (IBAN/BSN/ID) zodat je ingepland en uitbetaald kunt worden. Read-only — alleen jouw eigen profiel.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await chefMyProfile(requireChefId(ctx));
    if (!data) throw new Error("Geen gekoppeld chef-profiel.");
    return {
      data,
      summary:
        `Onboarding: ${data.onboarding}.` +
        (data.missing.length ? ` Nog nodig: ${data.missing.join(", ")}.` : " Alle gegevens compleet."),
    };
  },
});
