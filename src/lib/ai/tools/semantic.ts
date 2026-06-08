/**
 * Semantic search tool (RAG Layer-2, v1) — find chefs by meaning, not exact fields. Wraps
 * the vector retrieval over the embedding-refresh corpus. Read-only; degrades to a clear
 * "niet beschikbaar" message when embeddings aren't available.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { semanticSearchChefs, semanticSearchClients } from "@/lib/ai/read-model/semantic";

export const chefsSemanticSearch = defineTool({
  name: "chefs.semantic_search",
  title: "Chefs zoeken op betekenis",
  description:
    "Zoek chefs op een vrije omschrijving/betekenis i.p.v. exacte velden — bijv. 'ervaren sushi-chef die ook events doet' of 'iemand zoals Daniel'. Vult chefs.find (exacte zoektermen) aan met semantisch zoeken over chef-profielen (naam, vakniveau, specialiteiten, segmenten, notities). Read-only.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    query: z.string().min(2, "geef een korte omschrijving"),
    limit: z.number().int().min(1).max(15).optional(),
  }),
  run: async (input) => {
    const matches = await semanticSearchChefs(input.query, input.limit ?? 8);
    if (matches === null) {
      return {
        data: { available: false },
        summary: "Semantisch zoeken is nu niet beschikbaar (embeddings staan uit of zijn nog niet gegenereerd).",
      };
    }
    return {
      data: { count: matches.length, matches },
      summary:
        matches.length === 0
          ? "Geen semantische matches gevonden (profielen zijn mogelijk nog niet geïndexeerd)."
          : `${matches.length} chef(s) gevonden — beste match: ${matches[0].name} (${Math.round(matches[0].similarity * 100)}%).`,
    };
  },
});

export const clientsSemanticSearch = defineTool({
  name: "clients.semantic_search",
  title: "Klanten zoeken op betekenis",
  description:
    "Zoek klanten op een vrije omschrijving/betekenis — bijv. 'fine-dining hotels in Amsterdam' of 'klanten zoals Okura'. Vult clients.find (exacte zoektermen) aan met semantisch zoeken over klantprofielen. Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({
    query: z.string().min(2, "geef een korte omschrijving"),
    limit: z.number().int().min(1).max(15).optional(),
  }),
  run: async (input) => {
    const matches = await semanticSearchClients(input.query, input.limit ?? 8);
    if (matches === null) {
      return {
        data: { available: false },
        summary: "Semantisch zoeken is nu niet beschikbaar (embeddings staan uit of zijn nog niet gegenereerd).",
      };
    }
    return {
      data: { count: matches.length, matches },
      summary:
        matches.length === 0
          ? "Geen semantische matches gevonden."
          : `${matches.length} klant(en) gevonden — beste match: ${matches[0].name} (${Math.round(matches[0].similarity * 100)}%).`,
    };
  },
});
