/**
 * Saved searches (Phase B2) — Maarten pins his repeated chef-search filter combos as
 * one-click buttons. Owner-scoped: every read/write is keyed by ownerUserId (auth IS the
 * lookup — the caller passes session.user.id, never form data). `query` is the
 * chef-directory querystring; the button deep-links to /admin/business/chefs?<query>.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { savedSearches, type SavedSearch } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

export type SavedSearchKind = "chef_search" | "dashboard_action";

export async function listSavedSearches(ownerUserId: string, kind?: SavedSearchKind): Promise<SavedSearch[]> {
  const where = kind
    ? and(eq(savedSearches.ownerUserId, ownerUserId), eq(savedSearches.kind, kind))
    : eq(savedSearches.ownerUserId, ownerUserId);
  return db.select().from(savedSearches).where(where).orderBy(asc(savedSearches.sortOrder), asc(savedSearches.createdAt));
}

export async function createSavedSearch(args: {
  ownerUserId: string;
  label: string;
  query: string;
  kind?: SavedSearchKind;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const label = args.label.trim().slice(0, 60);
  if (!label) return { ok: false, error: "Geef de knop een naam." };
  const query = args.query.trim().replace(/^\?/, "").slice(0, 500);
  const [row] = await db
    .insert(savedSearches)
    .values({ ownerUserId: args.ownerUserId, label, query, kind: args.kind ?? "chef_search" })
    .returning({ id: savedSearches.id });
  await recordAuditCore({
    userId: args.ownerUserId,
    action: "saved_search.created",
    resource: "saved_searches",
    resourceId: row.id,
    after: { label, query, kind: args.kind ?? "chef_search" },
  }).catch(() => {});
  return { ok: true, id: row.id };
}

/** Atomic, auth-scoped delete — only the owner can remove their own button (0 rows ⇒ not theirs). */
export async function deleteSavedSearch(id: string, ownerUserId: string): Promise<boolean> {
  const deleted = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.ownerUserId, ownerUserId)))
    .returning({ id: savedSearches.id });
  if (deleted.length === 0) return false;
  await recordAuditCore({
    userId: ownerUserId,
    action: "saved_search.deleted",
    resource: "saved_searches",
    resourceId: id,
  }).catch(() => {});
  return true;
}
