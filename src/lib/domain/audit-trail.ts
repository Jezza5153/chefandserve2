/**
 * Per-entity audit trail (Phase E1) — "alles wat er met deze chef/dienst/klant gebeurde".
 * Reads auditLog filtered by (resource, resourceId), joins the actor, and maps the raw
 * action key to a friendly Dutch label. Metadata only (who/what/when) — never the
 * before/after payloads, so it's safe to surface on entity pages. Reuses the
 * auditLog(resource, resourceId) index (migration 0075).
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";

export type AuditTrailEntry = { id: string; actionKey: string; label: string; who: string | null; at: Date };

/** Curated labels for the common keys; everything else is prettified from the key. */
const ACTION_LABELS: Record<string, string> = {
  "chefs.owner_tags_updated": "Eigen labels aangepast",
  "chefs.intel_updated": "Intel (brein) aangepast",
  "chefs.whatsapp_toggled": "WhatsApp-voorkeur gewijzigd",
  "chefs.profile_updated": "Profiel bijgewerkt",
  "chef.profile_change_requested": "Wijzigingsverzoek ingediend",
  "chefs.basics_updated": "Basisgegevens aangepast",
  "ratings.created": "Klantbeoordeling toegevoegd",
  "ratings.internal_created": "Eigen beoordeling toegevoegd",
  "saved_search.created": "Zoekknop opgeslagen",
  "saved_search.deleted": "Zoekknop verwijderd",
  "escalation.opened": "Spoedsituatie geopend",
  "escalation.resolved": "Spoedsituatie opgelost",
  "escalation.stood_down": "Spoedsituatie stilgelegd",
  "placements.compliance_override": "Compliance-override (met reden)",
  "placements.margin_override": "Marge-override (met reden)",
};

function prettify(key: string): string {
  const base = ACTION_LABELS[key];
  if (base) return base;
  // "chefs.owner_tags_updated" → "Chefs · owner tags updated"
  const [ns, ...rest] = key.split(".");
  const tail = rest.join(".").replace(/_/g, " ").trim();
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return tail ? `${cap(ns)} · ${tail}` : cap(ns);
}

export async function entityAuditTrail(resource: string, resourceId: string, limit = 50): Promise<AuditTrailEntry[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      actionKey: auditLog.action,
      at: auditLog.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.resource, resource), eq(auditLog.resourceId, resourceId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    actionKey: r.actionKey,
    label: prettify(r.actionKey),
    who: r.name ?? r.email ?? null,
    at: r.at,
  }));
}
