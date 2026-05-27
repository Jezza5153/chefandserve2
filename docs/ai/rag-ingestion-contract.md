# RAG Ingestion Contract

> The contract between the indexer worker, the embeddings store, and the retriever. When the AI ships, this is what `workers/embedding-refresh.ts` must produce.

Pairs with [`rag-source-catalog.md`](./rag-source-catalog.md) (which sources, which visibility) and the strategic vision in [`../../AI_INTEGRATION.md`](../../AI_INTEGRATION.md) (Layer 2).

Status: **not built yet**. `workers/embedding-refresh.ts` is a no-op stub. pgvector extension is enabled on Neon. This doc is the spec the worker must satisfy before flipping it on.

---

## Storage shape

A single Postgres table `ai_embeddings` (proposed, not yet created):

```sql
CREATE TABLE ai_embeddings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_text    text        NOT NULL,
  embedding     vector(1536)  NOT NULL,  -- text-embedding-3-small dim
  source_table  text        NOT NULL,
  source_pk     text        NOT NULL,
  field         text        NOT NULL,
  chunk_index   integer     NOT NULL DEFAULT 0,
  tenant_scope  text        NOT NULL,        -- e.g. 'chefId:abc-123', 'public'
  visibility    text        NOT NULL,        -- enum from rag-source-catalog.md
  redaction_version integer NOT NULL,
  indexed_at    timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz                 -- set when reindexed; soft-delete
);

CREATE INDEX ai_embeddings_source_idx ON ai_embeddings(source_table, source_pk);
CREATE INDEX ai_embeddings_tenant_idx ON ai_embeddings(tenant_scope);
-- HNSW or IVFFlat index on embedding column TBD per pgvector benchmarks
```

**Hard rule:** `ai_embeddings` rows for a given `(source_table, source_pk, field, chunk_index)` are *soft-superseded* on reindex (set `superseded_at`), not deleted. This keeps the audit trail; a retention worker prunes superseded rows older than 30 days.

---

## Chunking rules

### General

- **Chunk size:** ~500 tokens (≈2000 chars) target. Hard cap: 1000 tokens.
- **Overlap:** 50 tokens between adjacent chunks for the same source row.
- **Boundary respect:** never split mid-sentence. Prefer paragraph or list-item boundaries.
- **Embedding model:** `text-embedding-3-small` (1536-dim, OpenAI) at launch. Switching means full reindex + bump `redaction_version`.

### Per source

| Source | Chunk strategy |
|---|---|
| `chefs.notes` | One chunk per chef if notes < 500 tokens; else paragraph-split with overlap. Prepend `"Chef <fullName>, vakniveau <vakniveau>, segments <segments>: "` so the embedding captures context. |
| `chefs.specialties` | One chunk per chef; concatenate `specialties + languages + segments`. |
| `clients.notes` | Same pattern as chefs.notes. Prepend `"Klant <companyName>, segment <segment>, locatie <city>: "`. |
| `shifts.notes` + `whenDescription` | One chunk per shift. Prepend `"Shift bij <client.companyName> op <date>, rol <role>: "`. |
| `chef_documents` CV text (uploaded by chef themselves) | Page-by-page OCR (only for `type='cv'` AND `uploadedBy = chef.userId`). Never OCR ID documents. |
| Project docs (`docs/`, `MEMORY.md`, `WORKFLOW.md`, `AI_INTEGRATION.md`) | Markdown heading-aware chunking: each H2/H3 section becomes a chunk; prepend the section path. |
| `email_messages` (bodies, where access-filtered) | One chunk per email; redact emails/phones/BSN/IBAN before embedding. |
| `contact_logs` | One chunk per row. Plain-text. Admin-only visibility. |
| `placements` outcomes joined with ratings + hours | One chunk per completed placement. Prepend `"Placement: chef <chefName> at <clientCompanyName> on <shiftDate>, rating <stars>, hours discrepancy <minutes>: "`. |

### Redaction step (mandatory before embedding)

For every chunk pulled from a source containing user-generated text:

1. Strip strings matching email regex → replace with `<email>`.
2. Strip strings matching phone regex (NL: `\+31|06|0[1-9]…`) → replace with `<phone>`.
3. Strip BSN-shaped strings (9 digits) → replace with `<bsn>`.
4. Strip IBAN-shaped strings → replace with `<iban>`.
5. Strip 16-digit credit-card-shaped strings → replace with `<card>`.
6. Strip dates of birth (DD-MM-YYYY where YYYY is 1900–2010) → replace with `<dob>`.

This is done at INDEX time, not at retrieval time, so embeddings never carry PII.

If a chunk would become unintelligible after redaction (>30% of tokens replaced), SKIP indexing that chunk and emit `ai.index_skipped_pii_dense` audit event.

---

## Metadata schema (mandatory)

Every chunk MUST have:

```jsonc
{
  "source_table": "chefs",              // matches Drizzle table name
  "source_pk":    "<uuid or text id>",
  "field":        "notes",              // field/column name
  "chunk_index":  0,                    // 0-based, for multi-chunk sources
  "tenant_scope": "chefId:<uuid>",      // see below
  "visibility":   "chef_own_and_admin", // from rag-source-catalog.md
  "redaction_version": 1                // increment to force reindex
}
```

### `tenant_scope` patterns

- `chefId:<uuid>` — chunk belongs to that chef's data.
- `clientId:<uuid>` — chunk belongs to that klant's data.
- `placement:<placementId>` — chunk is shared by chef + klant of that placement (bridge).
- `internal` — admin-only.
- `public` — broad index.

A chunk can have ONLY ONE `tenant_scope`. If it logically belongs to two (e.g. a chunk about a chef-at-klant placement), choose `placement:<id>` and rely on the retriever to expand to both sides.

---

## Retrieval rules

### Query-time filter

The retriever (proposed `src/lib/rag/retrieve.ts`, not yet built) MUST filter results by the caller's tenant scopes BEFORE returning to the LLM.

```ts
function callerScopes(session): string[] {
  const scopes = ["public"];
  if (session.user.kind === "internal") scopes.push("internal");
  if (session.user.kind === "chef") {
    scopes.push(`chefId:${session.user.entityId}`);
    // expand placement bridges:
    scopes.push(...activePlacementsForChef(session.user.entityId).map(p => `placement:${p.id}`));
  }
  if (session.user.kind === "client") {
    scopes.push(`clientId:${session.user.entityId}`);
    scopes.push(...activePlacementsForClient(session.user.entityId).map(p => `placement:${p.id}`));
  }
  return scopes;
}

// retrieval
const results = await db
  .select(...)
  .from(aiEmbeddings)
  .where(and(
    inArray(aiEmbeddings.tenantScope, callerScopes(session)),
    isNull(aiEmbeddings.supersededAt),
    visibilityAllowedFor(session, aiEmbeddings.visibility)
  ))
  .orderBy(cosineDistance(aiEmbeddings.embedding, queryEmbedding))
  .limit(20);
```

### Hard rules

1. **No retrieval without an authenticated session.** Embeddings are not anonymous.
2. **No cross-tenant leak.** If `chefId:A` queries, `chefId:B`'s chunks are not in the results, even if the cosine similarity is highest.
3. **Visibility filter runs AFTER scope filter.** Belt and braces.
4. **Top-k cap.** Default `k=20`. The LLM context window matters less than the principle of minimum context.
5. **Cite or drop.** Every chunk returned to the LLM is referenced by `source_table:source_pk` in the answer. If the LLM cites a fact, that fact must trace back to a chunk's `source_pk` AND ALSO be re-verifiable in the canonical DB row.
6. **Stale guard.** If the caller's query asks about a fact more recent than the embedding (`indexedAt`), the retriever ALSO fetches the live row from the canonical table and the LLM is instructed to prefer the live value. Embeddings are for semantic search, not facts.

---

## Refresh + retention

### Refresh

`workers/embedding-refresh.ts` (nightly, currently a no-op stub):

1. For each source table with a `updatedAt` column: select rows where `updatedAt > last_run`.
2. For each row, generate fresh chunks → embed → INSERT new rows in `ai_embeddings` → set `superseded_at` on old chunks for the same `(source_pk, field)`.
3. Emit `ai.indexing_completed` audit event with counts: `chunks_indexed`, `chunks_superseded`, `chunks_skipped_pii_dense`.

### Retention

`workers/retention.ts` (PR-CHEF-10 will fill in):

1. DELETE `ai_embeddings` WHERE `superseded_at < now() - interval '30 days'`.
2. DELETE `ai_embeddings` WHERE the source row has been soft-deleted (`deleted_at IS NOT NULL`) more than 30 days ago.
3. If a chef is fully erased via AVG flow → DELETE all `ai_embeddings` with `tenant_scope = 'chefId:<their id>'` synchronously, not via retention worker.

### Reindex triggers requiring synchronous reembedding

These can't wait for nightly:

- User accepts an AVG erasure request → purge that user's chunks now.
- Admin verifies / rejects a document where CV text was indexed → reindex chef chunks now.
- Redaction rule version bump → trigger full reindex.

---

## Observability

The indexer emits structured logs (JSON, stdout):

```jsonc
{
  "level": "info",
  "ts": "...",
  "msg": "ai.indexing_completed",
  "source_table": "chefs",
  "chunks_indexed": 14,
  "chunks_superseded": 12,
  "chunks_skipped_pii_dense": 1,
  "duration_ms": 4200
}
```

Audit events (in `auditLog`):

- `ai.indexing_completed` — per-source counts.
- `ai.indexing_skipped` — when a source is intentionally skipped (e.g. dense PII).
- `ai.indexing_violation` — when an indexer attempted to index a `NEVER` source. This is a P0 incident.

---

## Open questions for Phase 9 kick-off

1. **Hosted vs. self-hosted embeddings.** OpenAI is cheap + accurate; self-hosted BGE buys data residency. Default: OpenAI for V1.
2. **HNSW vs. IVFFlat index.** Benchmark on real Chef & Serve scale (≤100k chunks expected at V1).
3. **Cross-encoder rerank?** Likely skip for V1; add when relevance is the bottleneck.
4. **Multilingual model?** Maarten + chefs speak NL+EN+FR+ES. `text-embedding-3-small` handles this; verify with eval set.
5. **Versioned `redaction_version`.** Plan to bump every time we tighten redaction; full reindex is OK overnight.

---

## Pre-flight checklist before turning RAG on

- [ ] `ai_embeddings` table exists + indexes.
- [ ] Redaction step has a unit test (every regex pattern matched).
- [ ] `tenant_scope` filter has an integration test (chefA query never returns chefB chunks).
- [ ] `visibility` filter has an integration test (klant query never returns admin_only chunks).
- [ ] Indexer logs `ai.indexing_completed` with counts.
- [ ] `workers/retention.ts` removes superseded chunks on schedule.
- [ ] Synchronous purge path tested for AVG erasure.
- [ ] All Restricted + NEVER sources verified NOT in `ai_embeddings` (smoke test).
