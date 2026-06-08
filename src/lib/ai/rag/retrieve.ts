/**
 * RAG retrieval (docs/ai/rag-ingestion-contract.md §Retrieval rules). Embeds the query, then
 * cosine-searches ai_embeddings — but ONLY over chunks the caller may see: the access filter
 * (src/lib/ai/rag/access.ts) becomes a WHERE clause so out-of-scope chunks never enter the
 * candidate set, let alone the LLM. Belt + braces: tenant_scope AND visibility both filter.
 *
 * Degrades to null (not an error) when embeddings are unavailable (no key) or the table isn't
 * there yet, so the tool can say "niet beschikbaar" instead of throwing.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { embedText, vectorLiteral } from "@/lib/ai/embeddings";
import { accessFilterFor, type RagActor } from "@/lib/ai/rag/access";

export type RetrievedChunk = {
  sourceTable: string;
  sourcePk: string;
  field: string;
  chunkIndex: number;
  tenantScope: string;
  visibility: string;
  text: string;
  similarity: number; // 0..1 (1 = identical direction)
  indexedAt: string;
};

const DEFAULT_K = 12;
const MAX_K = 20; // contract §Retrieval rule 4: minimum-context principle

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown[] })?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

export async function retrieveKnowledge(args: {
  query: string;
  actor: RagActor;
  limit?: number;
}): Promise<RetrievedChunk[] | null> {
  const vec = await embedText(args.query);
  if (!vec) return null; // no key / embed failed → caller degrades gracefully
  const lit = vectorLiteral(vec);
  const filter = accessFilterFor(args.actor);
  const k = Math.min(MAX_K, Math.max(1, args.limit ?? DEFAULT_K));

  const visList = sql.join(
    filter.visibilities.map((v) => sql`${v}`),
    sql`, `,
  );
  // admin (tenantScopes === null) spans all tenants; chef/klant are scoped.
  const scopeClause =
    filter.tenantScopes === null
      ? sql``
      : sql`AND tenant_scope = ANY(ARRAY[${sql.join(
          filter.tenantScopes.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[])`;

  let res: unknown;
  try {
    res = await db.execute(sql`
      SELECT source_table, source_pk, field, chunk_index, tenant_scope, visibility, chunk_text,
             round((1 - (embedding <=> ${lit}::vector))::numeric, 3) AS similarity,
             indexed_at
      FROM ai_embeddings
      WHERE superseded_at IS NULL
        AND visibility = ANY(ARRAY[${visList}]::text[])
        ${scopeClause}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${k}
    `);
  } catch {
    return null; // table / pgvector extension not present yet
  }

  return rowsOf(res).map((r) => ({
    sourceTable: String(r.source_table),
    sourcePk: String(r.source_pk),
    field: String(r.field),
    chunkIndex: Number(r.chunk_index ?? 0),
    tenantScope: String(r.tenant_scope),
    visibility: String(r.visibility),
    text: String(r.chunk_text),
    similarity: Number(r.similarity),
    indexedAt: r.indexed_at ? String(r.indexed_at) : "",
  }));
}
