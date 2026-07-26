/**
 * Staffing tools — the assistant's day-to-day ops eyes:
 *  - planner.cockpit   : "wat heeft vandaag mijn aandacht" (intake + urgent queue + top match)
 *  - shifts.suggest_chefs : "welke chefs passen bij deze dienst" (ranked, with reasons)
 * Both read-only, wrapping the existing planner-intel + matching engines.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import {
  plannerCockpit,
  suggestChefsForShift,
  shiftMargin,
  matchChefsToRequirement,
} from "@/lib/ai/read-model/staffing";

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

export const shiftsMargin = defineTool({
  name: "shifts.margin",
  title: "Marge van een dienst",
  description:
    "Is een dienst winstgevend? Contributiemarge-INDICATIE: omzet (klanttarief) − chefkosten inclusief werkgeverslasten (percentage uit de geld-aannames, instelbaar op /admin/business/money-assumptions) — per chef én totaal, in EUR, met een tone. Reiskosten/no-show/oninbaar zitten er NIET in; zeg dat erbij als het om een krappe marge gaat. Gebruik shifts.find voor het shiftId.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({ shiftId: z.string().min(1, "shiftId is verplicht") }),
  run: async (input) => {
    const data = await shiftMargin(input.shiftId);
    if (!data) throw new Error("deze dienst bestaat niet (meer)");
    if (!data.priced) {
      return { data, summary: `${data.shift.client ?? "Dienst"} (${data.shift.role}): nog geen tarieven ingevuld — marge onbekend.` };
    }
    const toneNl: Record<string, string> = { ok: "gezond", low: "laag", negative: "negatief" };
    return {
      data,
      summary: `${data.shift.client ?? "Dienst"} (${data.shift.role}): marge €${data.total.marginEur.toLocaleString("nl-NL")} totaal (€${data.perChef.marginEur}/chef, ${data.basis}) — ${toneNl[data.tone] ?? data.tone}.`,
    };
  },
});

export const chefsMatchRequirement = defineTool({
  name: "chefs.match_requirement",
  title: "Beste chefs voor een omschrijving",
  description:
    "De best passende chefs voor een omschreven behoefte, ZONDER dat er al een dienst in het systeem staat. " +
    'Gebruik dit zodra Maarten hardop nadenkt: "wie kan zaterdag in Rotterdam patisserie", "ik zoek een sous-chef voor volgende week vrijdag". ' +
    "Zelfde score, redenen en waarschuwingen als shifts.suggest_chefs — dat blijft de keuze zodra er wél een shiftId is. " +
    "Geeft naast de treffers ook `nearMisses`: chefs die op ÉÉN eis afvielen, met welke eis dat was. " +
    "Noem die altijd als er weinig of geen treffers zijn, zodat Maarten weet wat hij kan loslaten. Read-only.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({
    roleNeeded: z
      .enum([
        "keukenhulp", "commis", "chef_de_partie", "sous_chef", "chef_de_cuisine",
        "executive_chef", "patissier", "banqueting", "breakfast", "roomservice",
        "runner", "host", "bediening",
      ])
      .describe("Welk vakniveau er nodig is. Verplicht — dit is de harde eis in de score."),
    date: z.string().optional().describe("Datum JJJJ-MM-DD. Zet beschikbaarheid + dubbel-geboekt-check aan."),
    city: z.string().optional(),
    segment: z.string().optional().describe("Bijv. hotel, fine_dining, michelin, banqueting."),
    minExperience: z.number().int().min(0).max(50).optional(),
    languageRequired: z.string().optional(),
    maxRateCents: z.number().int().positive().optional().describe("Max uurtarief in centen (€35 = 3500)."),
    skillTags: z.array(z.string()).optional(),
    clientId: z.string().optional().describe("Klant-id: past hun favorieten/blokkades en locatie toe (clients.find)."),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  run: async (input) => {
    const { matches, nearMisses, notes } = await matchChefsToRequirement(input);
    if (matches.length === 0) {
      // Never dead-end: say WHICH constraint emptied the list.
      const by = new Map<string, number>();
      for (const n of nearMisses) by.set(n.blockedBy, (by.get(n.blockedBy) ?? 0) + 1);
      const breakdown = [...by.entries()].map(([why, n]) => `${n}× ${why}`).join(" · ");
      return {
        data: { count: 0, matches, nearMisses, notes },
        summary: nearMisses.length
          ? `Geen chef voldoet aan álle eisen. Dichtstbij: ${breakdown}.`
          : "Geen chefs gevonden die aan de voorfilters voldoen.",
      };
    }
    return {
      data: { count: matches.length, matches, nearMisses, notes },
      summary:
        `${matches.length} chef(s) — beste: ${matches[0].chefName} (score ${matches[0].score}).` +
        (nearMisses.length ? ` ${nearMisses.length} vielen op één eis af.` : ""),
    };
  },
});
