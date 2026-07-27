/**
 * Directory read tools — look up specific chefs and clients. No side effects → risk
 * "read", no confirmation. Safe display fields only (the read-model never exposes PII).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { findChefs, findClients, findShifts } from "@/lib/ai/read-model/directory";

export const chefsFind = defineTool({
  name: "chefs.find",
  title: "Chefs opzoeken",
  description:
    'Zoek chefs. Combineer gerust meerdere eisen — ze worden ALLEMAAL toegepast (EN), niet één ervan. ' +
    'Gebruik `query` alleen voor losse tekst (een naam, een gerecht, een hotel waar iemand werkte: "Daniel", "sushi", "Okura"). ' +
    'De vrije tekst zoekt óók in de interne notities (oude-systeem kennis) — een chef kan dus matchen op iets uit zijn historie; de notitietekst zelf komt niet mee in het antwoord. ' +
    'Zet elke concrete eis in zijn eigen veld: city, vakniveau, segment, skillTags, language, maxRateCents, minRating, availableOn. ' +
    'Bijv. "sous-chef in Utrecht die NL spreekt onder €35" → vakniveau=sous_chef, city=Utrecht, language=NL, maxRateCents=3500. ' +
    'Laat alles leeg voor de best beoordeelde chefs. Archiveerde chefs blijven standaard buiten beeld. ' +
    'Let op het veld `notes` in het antwoord: daarin staat wat NIET gefilterd kon worden — noem dat altijd tegen Maarten. Read-only.',
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    query: z.string().optional().describe("Losse tekst: naam, specialiteit, eerder werkadres."),
    city: z.string().optional().describe("Woonplaats van de chef."),
    vakniveau: z
      .enum([
        "keukenhulp", "commis", "chef_de_partie", "sous_chef", "chef_de_cuisine",
        "executive_chef", "patissier", "banqueting", "breakfast", "roomservice",
        "runner", "host", "bediening",
      ])
      .optional(),
    segment: z.string().optional().describe("Bijv. hotel, fine_dining, michelin, banqueting."),
    skillTags: z.array(z.string()).optional().describe("Vaardigheidssleutels; matcht als de chef er MINSTENS ÉÉN van heeft."),
    language: z.string().optional().describe('Eén taal, bijv. "NL" of "Engels".'),
    maxRateCents: z.number().int().positive().optional().describe("Max uurtarief in centen (€35 = 3500)."),
    minRating: z.number().min(1).max(5).optional(),
    availableOn: z.string().optional().describe("Datum JJJJ-MM-DD. Sluit chefs uit die die dag geblokkeerd hebben."),
    includeInactive: z.boolean().optional().describe("Ook gearchiveerde chefs meenemen. Standaard nee."),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const { query, ...rest } = input;
    const { chefs: rows, notes } = await findChefs({ q: query, ...rest });
    const asked = Object.entries(rest).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "",
    ).length;
    return {
      data: { count: rows.length, chefs: rows, notes },
      summary: rows.length
        ? `${rows.length} chef(s) gevonden.`
        : asked
          ? "Geen chefs die aan álle eisen voldoen — probeer één eis los te laten."
          : "Geen chefs gevonden.",
    };
  },
});

export const clientsFind = defineTool({
  name: "clients.find",
  title: "Klanten opzoeken",
  description:
    "Zoek klanten/opdrachtgevers op bedrijfsnaam, contactpersoon of stad. Laat de zoekterm leeg voor een lijst (gelimiteerd). Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const rows = await findClients({ q: input.query, limit: input.limit });
    return {
      data: { count: rows.length, clients: rows },
      summary: rows.length ? `${rows.length} klant(en) gevonden.` : "Geen klanten gevonden.",
    };
  },
});

export const shiftsFind = defineTool({
  name: "shifts.find",
  title: "Diensten opzoeken",
  description:
    'Zoek diensten (shifts) op klantnaam, rol, locatie of stad — én op datum: vul bij ELKE datumvraag ("zaterdag", "volgende week") from/to in als JJJJ-MM-DD, anders krijg je gewoon de nieuwste 25. Filter optioneel op status. Read-only.',
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({
    query: z.string().optional(),
    status: z.enum(["request", "open", "filled", "completed", "cancelled"]).optional(),
    from: z.string().optional().describe("Vanaf-datum JJJJ-MM-DD (Amsterdamse dag). Voor élke datumvraag verplicht invullen."),
    to: z.string().optional().describe("Tot-en-met-datum JJJJ-MM-DD. Zelfde dag als from = precies die dag."),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const { shifts: rows, totalMatched } = await findShifts({
      q: input.query,
      status: input.status,
      from: input.from,
      to: input.to,
      limit: input.limit,
    });
    return {
      data: { count: rows.length, totalMatched, shifts: rows },
      summary:
        rows.length === 0
          ? "Geen diensten gevonden."
          : totalMatched > rows.length
            ? `${rows.length} van ${totalMatched} diensten getoond — verfijn met from/to of status.`
            : `${rows.length} dienst(en) gevonden.`,
    };
  },
});
