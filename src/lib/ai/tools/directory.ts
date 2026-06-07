/**
 * Directory read tools — look up specific chefs and clients. No side effects → risk
 * "read", no confirmation. Safe display fields only (the read-model never exposes PII).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { findChefs, findClients } from "@/lib/ai/read-model/directory";

export const chefsFind = defineTool({
  name: "chefs.find",
  title: "Chefs opzoeken",
  description:
    'Zoek chefs op naam, stad, specialiteit of segment (bijv. "Daniel", "sushi", "fine dining"). Laat de zoekterm leeg voor de best beoordeelde chefs. Read-only.',
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const rows = await findChefs({ q: input.query, limit: input.limit });
    return {
      data: { count: rows.length, chefs: rows },
      summary: rows.length ? `${rows.length} chef(s) gevonden.` : "Geen chefs gevonden.",
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
