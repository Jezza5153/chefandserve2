/**
 * RAG access control — the tenant_scope + visibility filter that runs BEFORE any chunk
 * reaches the LLM (docs/ai/rag-ingestion-contract.md §Retrieval rules, rag-source-catalog.md
 * §Visibility enum). PURE + no DB import so it's unit-tested key-free in smoke-ai-rag.mts —
 * this is the load-bearing "no cross-tenant leak" guarantee, so it must be testable in
 * isolation.
 *
 * Two filters compose (belt + braces):
 *   1. tenant_scope ∈ caller's scopes   (admin = null = spans all tenants)
 *   2. visibility    ∈ caller's allowed visibilities
 * A chunk is returned only if BOTH pass. So a chefId:self chunk tagged admin_only is still
 * invisible to that chef (visibility blocks it), and an admin_only chunk for chef B is
 * invisible to chef A (scope AND visibility block it).
 */

/** The six visibility tiers from rag-source-catalog.md §Visibility enum. */
export const VISIBILITIES = [
  "public",
  "chef_own_and_admin",
  "klant_own_and_admin",
  "placement_bridge",
  "admin_only",
  "super_admin_only",
] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Who is asking. `internal` = a Chef & Serve staffer (owner / super_admin) — the only caller
 * in V1 (the assistant is owner-only). chef/client carry their entity id + active-placement
 * ids so the future chef/klant PAs reuse this unchanged.
 */
export type RagActor =
  | { kind: "internal"; superAdmin?: boolean }
  | { kind: "chef"; entityId: string; placementIds?: string[] }
  | { kind: "client"; entityId: string; placementIds?: string[] };

export type AccessFilter = {
  /** Allowed tenant_scopes. `null` = no scope restriction (admin spans every tenant). */
  tenantScopes: string[] | null;
  /** Allowed visibility tiers. */
  visibilities: Visibility[];
};

/** Visibilities a non-super-admin staffer may read: everything except super_admin_only. */
const ADMIN_VISIBILITIES: Visibility[] = [
  "public",
  "chef_own_and_admin",
  "klant_own_and_admin",
  "placement_bridge",
  "admin_only",
];

/** A chef sees only public, their own chef chunks, and placement-bridge chunks. */
const CHEF_VISIBILITIES: Visibility[] = ["public", "chef_own_and_admin", "placement_bridge"];

/** A klant sees only public, their own klant chunks, and placement-bridge chunks. */
const CLIENT_VISIBILITIES: Visibility[] = ["public", "klant_own_and_admin", "placement_bridge"];

/**
 * The retrieval filter for a caller. PURE — no DB, no I/O. The retriever applies it as a
 * WHERE clause; nothing outside this filter ever reaches the model.
 */
export function accessFilterFor(actor: RagActor): AccessFilter {
  if (actor.kind === "internal") {
    return {
      tenantScopes: null, // admin spans all tenants; NEVER sources are excluded by not being indexed, not by scope
      visibilities: actor.superAdmin ? [...VISIBILITIES] : ADMIN_VISIBILITIES,
    };
  }
  if (actor.kind === "chef") {
    return {
      tenantScopes: [
        "public",
        `chefId:${actor.entityId}`,
        ...(actor.placementIds ?? []).map((p) => `placement:${p}`),
      ],
      visibilities: CHEF_VISIBILITIES,
    };
  }
  return {
    tenantScopes: [
      "public",
      `clientId:${actor.entityId}`,
      ...(actor.placementIds ?? []).map((p) => `placement:${p}`),
    ],
    visibilities: CLIENT_VISIBILITIES,
  };
}
