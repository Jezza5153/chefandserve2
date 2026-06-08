/**
 * Synchronous RAG purge — AVG art. 17 (docs/ai/rag-ingestion-contract.md §Reindex triggers
 * requiring synchronous reembedding). When a chef/klant is erased, their `ai_embeddings`
 * chunks must be deleted IMMEDIATELY (not 30 days later via the retention worker) — the
 * vectors + chunk_text still carry their (name-bearing) profile/notes/contact text.
 *
 * Deletes by `tenant_scope`, which is the right key: a chef erasure (`chefId:<id>`) removes
 * their notes + profile + contact-log chunks; a klant erasure (`clientId:<id>`) removes their
 * notes + every shift chunk (shifts.notes are scoped `clientId:<client_id>`) + contact logs.
 *
 * Best-effort + idempotent: returns the deleted count, degrades to 0 (never throws) if the
 * table/extension isn't there — so the legally-required erasure can never be blocked by an
 * embeddings-store issue. The nightly retention sweep is the backstop.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantScopesForSubject } from "@/lib/ai/rag/access";

export { tenantScopesForSubject };

/** Hard-delete every `ai_embeddings` chunk in the given tenant_scopes. Returns rows deleted. */
export async function purgeAiEmbeddingsForTenant(scopes: string[]): Promise<number> {
  if (scopes.length === 0) return 0;
  try {
    const res = await db.execute(sql`
      DELETE FROM ai_embeddings
      WHERE tenant_scope = ANY(ARRAY[${sql.join(
        scopes.map((s) => sql`${s}`),
        sql`, `,
      )}]::text[])
    `);
    const rc =
      (res as { rowCount?: number; rowsAffected?: number })?.rowCount ??
      (res as { rowsAffected?: number })?.rowsAffected ??
      0;
    return Number(rc) || 0;
  } catch {
    return 0; // table/extension absent — backstopped by workers/retention.ts
  }
}

/** Convenience wrapper for the erasure flow. */
export async function purgeAiEmbeddingsForSubject(subject: {
  chefId?: string | null;
  clientId?: string | null;
}): Promise<number> {
  return purgeAiEmbeddingsForTenant(tenantScopesForSubject(subject));
}
