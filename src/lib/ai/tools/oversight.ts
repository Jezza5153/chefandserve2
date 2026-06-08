/**
 * Oversight tools — let the owner assistant reach the Restricted (tool-only) data that RAG
 * never indexes: the audit trail, chef-document metadata, and privacy requests. All read-only,
 * permission-gated (audit.read / chefs.read / privacy.read), metadata-only (the read-models
 * strip payloads/bytes/raw text). Per docs/ai/rag-source-catalog.md §Restricted.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { searchAudit, chefDocumentsForAi, listPrivacyRequestsForAi } from "@/lib/ai/read-model/oversight";

export const auditSearch = defineTool({
  name: "audit.search",
  title: "Auditlog doorzoeken",
  description:
    "Doorzoek het auditlogboek: wie deed wat wanneer. Filter op resource (bijv. 'chefs', 'shifts', 'privacy_requests'), een specifiek id, een actie (deel van de naam, bijv. 'erasure' of 'approve'), of de laatste X dagen. Geeft actie · resource · wie · wanneer — NOOIT de gewijzigde waarden zelf (die kunnen privacygevoelig zijn). Read-only. Gebruik chefs.find/clients.find voor het id.",
  risk: "read",
  permission: { resource: "audit", action: "read" },
  input: z.object({
    resource: z.string().optional(),
    resourceId: z.string().optional(),
    action: z.string().optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: async (input) => {
    const rows = await searchAudit({ ...input, limit: input.limit ?? 20 });
    return {
      data: { count: rows.length, entries: rows },
      summary:
        rows.length === 0
          ? "Geen auditregels gevonden voor deze zoekopdracht."
          : `${rows.length} auditregel(s) — laatste: ${rows[0].action} (${rows[0].resource}) door ${rows[0].by} op ${rows[0].when}.`,
    };
  },
});

export const documentsListForChef = defineTool({
  name: "documents.list_for_chef",
  title: "Documenten van een chef",
  description:
    "De documenten van één chef — alléén metadata: soort (CV/ID/certificaat/…), bestandsnaam, status (geverifieerd/te controleren/afgekeurd), of het klant-zichtbaar is, en de verloopdatum (met 'verloopt binnenkort'/'verlopen'-signaal). NOOIT de bestandsinhoud zelf. Handig voor 'welke documenten heeft chef X / wat verloopt er?'. Read-only. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefDocumentsForAi(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    return {
      data,
      summary:
        data.documents.length === 0
          ? `${data.chef} heeft nog geen documenten.`
          : `${data.chef}: ${data.documents.length} document(en)${data.expiringOrExpired > 0 ? ` — ⚠ ${data.expiringOrExpired} verlopen/verloopt binnenkort` : ""}.`,
    };
  },
});

export const privacyListRequests = defineTool({
  name: "privacy.list_requests",
  title: "Privacyverzoeken (AVG)",
  description:
    "Lopende en afgehandelde privacyverzoeken (AVG): soort (inzage/correctie/verwijdering/export), status, aanvrager, of de identiteit geverifieerd is, en de wettelijke behandeltermijn (met 'verlopen!'-signaal). Filter optioneel op status (bijv. 'pending'). Geeft alléén metadata — nooit de ruwe verzoektekst. Read-only.",
  risk: "read",
  permission: { resource: "privacy", action: "read" },
  input: z.object({
    status: z.enum(["pending", "in_progress", "fulfilled", "rejected", "partially_fulfilled", "withdrawn"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: async (input) => {
    const rows = await listPrivacyRequestsForAi({ ...input, limit: input.limit ?? 20 });
    const overdue = rows.filter((r) => r.due?.includes("verlopen")).length;
    return {
      data: { count: rows.length, requests: rows },
      summary:
        rows.length === 0
          ? "Geen privacyverzoeken gevonden."
          : `${rows.length} privacyverzoek(en)${overdue > 0 ? ` — ⚠ ${overdue} over de behandeltermijn` : ""}.`,
    };
  },
});
