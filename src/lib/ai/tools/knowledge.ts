/**
 * knowledge.search — RAG over the internal kennisbank (chef/klant-notities, dienst-
 * omschrijvingen, contactgeschiedenis). Semantic recall on MEANING, mét bron per fragment.
 * Complements the exact-field finders (chefs.find/clients.find) and the per-row semantic
 * search: this one searches the free-text NOTES corpus, not just structured profiles.
 *
 * PII is stripped at index time (redact()), and retrieval is scope+visibility filtered
 * (rag/access.ts). Owner-only caller in V1 → sees all non-superseded chunks. Read-only;
 * degrades to a clear "niet beschikbaar" when embeddings are off / not yet generated.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { searchKnowledgeForOwner } from "@/lib/ai/read-model/knowledge";

export const knowledgeSearch = defineTool({
  name: "knowledge.search",
  title: "Doorzoek wat we weten (notities & contact)",
  description:
    "Semantisch doorzoeken van de interne kennisbank — chef- en klantnotities, dienstomschrijvingen en contactgeschiedenis — op betekenis i.p.v. exacte woorden. Elk resultaat komt mét bron (over wie/wat het gaat). Gebruik dit voor vragen als 'wat weten we over...', 'welke chef had ervaring met...', 'wat is er besproken rond...'. PII (mail/telefoon/IBAN) is bij het indexeren verwijderd. Vult chefs.find/clients.find (exacte velden) aan. Read-only.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    query: z.string().min(2, "geef een zoekterm of korte omschrijving"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  run: async (input) => {
    const result = await searchKnowledgeForOwner(input.query, input.limit ?? 12);
    if (!result.available) {
      return {
        data: { available: false },
        summary:
          "Kennisbank-zoeken is nu niet beschikbaar (embeddings staan uit of de notities zijn nog niet geïndexeerd).",
      };
    }
    if (result.count === 0) {
      return {
        data: { available: true, count: 0, hits: [] },
        summary: `Niets gevonden in de kennisbank voor "${input.query}".`,
      };
    }
    const top = result.hits[0];
    return {
      data: result,
      summary: `${result.count} fragment(en) gevonden — beste match: ${top.sourceLabel} (${top.similarityPct}%).`,
    };
  },
});
