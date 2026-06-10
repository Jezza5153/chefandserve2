/**
 * CHEF portal assistant tools — read-only, own-data-only. `permission: null` + `risk: "read"`
 * so they run immediately (no RBAC gate, no confirm); safety comes from the SCOPE: each tool
 * keys its query off `ctx.actor.subject.entityId` (the chef resolved from the session), never a
 * model-supplied id. A chef can only ever see their own diensten/uren/profiel.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import type { ToolContext } from "@/lib/ai/types";
import { chefMyShifts, chefMyHours, chefMyProfile, chefMyAvailability } from "@/lib/ai/read-model/chef-self";

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

export const chefMyAvailabilityTool = defineTool({
  name: "mijn.beschikbaarheid",
  title: "Mijn beschikbaarheid",
  description:
    "Jouw doorgegeven beschikbaarheid: hoeveel dagen je vooruit hebt ingevuld, je eerstvolgende beschikbare dag, en of je de komende 2 weken al hebt doorgegeven. Read-only — alleen jouw eigen beschikbaarheid.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await chefMyAvailability(requireChefId(ctx));
    return {
      data,
      summary: data.hasUpcomingTwoWeeks
        ? `Je hebt ${data.availableCount} beschikbare dag(en) doorgegeven${data.nextAvailable ? `; eerstvolgende: ${data.nextAvailable}` : ""}.`
        : "Je hebt nog geen beschikbaarheid voor de komende 2 weken doorgegeven — geef die door onder 'Beschikbaarheid'.",
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

export const chefMyDocumentsTool = defineTool({
  name: "mijn.documenten",
  title: "Mijn documenten",
  description:
    "Jouw eigen documenten (ID-kopie, certificaten, CV): wat staat er, is het geverifieerd en wanneer verloopt iets? Gebruik dit bij 'wanneer verloopt m'n certificaat / is m'n ID-kopie binnen?'. Read-only, alleen je eigen documenten.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx: ToolContext) => {
    const { chefMyDocuments } = await import("@/lib/ai/read-model/chef-self");
    const docs = await chefMyDocuments(requireChefId(ctx));
    if (docs.length === 0) return { data: { docs }, summary: "Je hebt nog geen documenten geüpload." };
    const expiring = docs.filter((d) => d.expiringSoon);
    return {
      data: { docs },
      summary: `${docs.length} document(en)${expiring.length ? ` — let op: ${expiring.map((d) => `${d.type} verloopt ${d.expiresAt}`).join(", ")}` : ", niets verloopt binnenkort"}.`,
    };
  },
});

export const chefMyRatingTool = defineTool({
  name: "mijn.beoordeling",
  title: "Mijn beoordeling",
  description:
    "Je eigen gemiddelde beoordeling. Het gemiddelde wordt pas zichtbaar vanaf 5 beoordelingen (huisregel); individuele beoordelingen of opmerkingen zie je niet. Read-only.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx: ToolContext) => {
    const { chefMyRating } = await import("@/lib/ai/read-model/chef-self");
    const r = await chefMyRating(requireChefId(ctx));
    return {
      data: r,
      summary:
        r.average != null
          ? `Je gemiddelde beoordeling is ${r.average}★ over ${r.count} beoordelingen.`
          : `Nog te weinig beoordelingen voor een gemiddelde (${r.count} van 5).`,
    };
  },
});
