-- Phase 9 prep — pgvector extension + embedding columns.
--
-- This migration is INTENTIONALLY manually-written (not Drizzle-generated)
-- because Drizzle doesn't know about pgvector. We add the vector(1536)
-- columns + a freshness tracking table that Drizzle CAN see, but the
-- vector columns themselves stay raw SQL.
--
-- After applying this, an embedding-refresh job (Railway worker) can:
--   1. SELECT rows where embedding IS NULL OR embedded_text_hash != current_hash
--   2. Compute text → OpenAI/Claude embedding API → vector(1536)
--   3. UPDATE row.embedding + embedded_at + embedded_text_hash
--
-- Phase 9 (LLM matching) reads these vectors for semantic search:
--   ORDER BY embedding <=> $queryEmbedding LIMIT 10

CREATE EXTENSION IF NOT EXISTS vector;

-- Chefs: embed profile text (name + vakniveau + segments + specialties + notes)
ALTER TABLE chefs ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE chefs ADD COLUMN IF NOT EXISTS embedded_text_hash text;
ALTER TABLE chefs ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Clients: embed company + segment + notes + history-derived summary
ALTER TABLE clients ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS embedded_text_hash text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Shifts: embed role + segment + notes + location for "find similar past shifts"
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS embedded_text_hash text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- HNSW indexes for fast nearest-neighbour search.
-- (vector_cosine_ops = cosine distance; vector_l2_ops = L2; vector_ip_ops = inner product.
-- Cosine is the right pick for normalized OpenAI/Claude embeddings.)
-- Conditional create_index on partial filters: only embed non-archived rows.
CREATE INDEX IF NOT EXISTS chefs_embedding_idx
  ON chefs USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS clients_embedding_idx
  ON clients USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS shifts_embedding_idx
  ON shifts USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
