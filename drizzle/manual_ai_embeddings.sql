-- RAG Stage 2 — chunked notes-RAG store (`ai_embeddings`).
--
-- INTENTIONALLY manually-written (Drizzle doesn't model pgvector). Pairs with
-- docs/ai/rag-ingestion-contract.md (§Storage shape) + rag-source-catalog.md
-- (§Visibility enum). Apply with:
--   npx tsx --env-file=.env.local scripts/apply-ai-embeddings.mts
-- (or paste into Neon SQL editor). Idempotent: IF NOT EXISTS throughout.
--
-- One row = one redacted, embedded text chunk from an Access-filtered source
-- (chef/client/shift notes, contact logs). PII is redacted at INDEX time
-- (src/lib/ai/rag/redact.ts) so the vectors + chunk_text never carry
-- email/phone/BSN/IBAN/card/DOB. Retrieval filters by the caller's
-- tenant_scope + visibility BEFORE the LLM ever sees a chunk
-- (src/lib/ai/rag/access.ts + retrieve.ts).
--
-- Soft-supersede on reindex (set superseded_at, never DELETE) — keeps the
-- audit trail; a retention worker prunes superseded rows >30 days old (future).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ai_embeddings (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_text        text          NOT NULL,
  embedding         vector(1536)  NOT NULL,          -- text-embedding-3-small dim
  source_table      text          NOT NULL,          -- 'chefs' | 'clients' | 'shifts' | 'contact_logs'
  source_pk         text          NOT NULL,
  field             text          NOT NULL,          -- 'notes' | 'profile' | 'contact_log' ...
  chunk_index       integer       NOT NULL DEFAULT 0,
  tenant_scope      text          NOT NULL,          -- 'chefId:<uuid>' | 'clientId:<uuid>' | 'internal' | 'public'
  visibility        text          NOT NULL,          -- enum from rag-source-catalog.md §Visibility enum
  redaction_version integer       NOT NULL,
  content_hash      text          NOT NULL,          -- sha256(redacted source text) — skip re-embed when unchanged
  indexed_at        timestamptz   NOT NULL DEFAULT now(),
  superseded_at     timestamptz                      -- set on reindex; soft-delete, never hard-DELETE inline
);

-- lookup + reindex (supersede the prior live chunks for a source row)
CREATE INDEX IF NOT EXISTS ai_embeddings_source_idx ON ai_embeddings (source_table, source_pk);
CREATE INDEX IF NOT EXISTS ai_embeddings_tenant_idx ON ai_embeddings (tenant_scope);
CREATE INDEX IF NOT EXISTS ai_embeddings_visibility_idx ON ai_embeddings (visibility);
-- the hot path: live chunks for one source row (idempotency check + supersede)
CREATE INDEX IF NOT EXISTS ai_embeddings_live_idx
  ON ai_embeddings (source_table, source_pk, field)
  WHERE superseded_at IS NULL;

-- HNSW cosine index for nearest-neighbour retrieval over LIVE chunks only
-- (vector_cosine_ops = cosine distance; the right pick for OpenAI embeddings).
CREATE INDEX IF NOT EXISTS ai_embeddings_embedding_idx
  ON ai_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE superseded_at IS NULL;
