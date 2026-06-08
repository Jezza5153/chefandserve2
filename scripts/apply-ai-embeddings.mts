/**
 * Apply the ai_embeddings store (canonical SQL: drizzle/manual_ai_embeddings.sql).
 * pgvector DDL Drizzle can't model — same pattern as manual_pgvector_prep.sql.
 *   npx tsx --env-file=.env.local scripts/apply-ai-embeddings.mts
 *
 * Statements are run as literal tagged-templates (the neon-http driver only runs
 * templates, not dynamic strings). Keep these in lock-step with the .sql file;
 * all are idempotent (CREATE … IF NOT EXISTS), so this is safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);

const steps: Array<[string, () => Promise<unknown>]> = [
  ["CREATE EXTENSION vector", () => sql`CREATE EXTENSION IF NOT EXISTS vector`],
  [
    "CREATE TABLE ai_embeddings",
    () => sql`
      CREATE TABLE IF NOT EXISTS ai_embeddings (
        id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        chunk_text        text          NOT NULL,
        embedding         vector(1536)  NOT NULL,
        source_table      text          NOT NULL,
        source_pk         text          NOT NULL,
        field             text          NOT NULL,
        chunk_index       integer       NOT NULL DEFAULT 0,
        tenant_scope      text          NOT NULL,
        visibility        text          NOT NULL,
        redaction_version integer       NOT NULL,
        content_hash      text          NOT NULL,
        indexed_at        timestamptz   NOT NULL DEFAULT now(),
        superseded_at     timestamptz
      )`,
  ],
  ["INDEX source", () => sql`CREATE INDEX IF NOT EXISTS ai_embeddings_source_idx ON ai_embeddings (source_table, source_pk)`],
  ["INDEX tenant", () => sql`CREATE INDEX IF NOT EXISTS ai_embeddings_tenant_idx ON ai_embeddings (tenant_scope)`],
  ["INDEX visibility", () => sql`CREATE INDEX IF NOT EXISTS ai_embeddings_visibility_idx ON ai_embeddings (visibility)`],
  [
    "INDEX live",
    () => sql`CREATE INDEX IF NOT EXISTS ai_embeddings_live_idx ON ai_embeddings (source_table, source_pk, field) WHERE superseded_at IS NULL`,
  ],
  [
    "INDEX hnsw cosine",
    () => sql`CREATE INDEX IF NOT EXISTS ai_embeddings_embedding_idx ON ai_embeddings USING hnsw (embedding vector_cosine_ops) WHERE superseded_at IS NULL`,
  ],
];

console.log(`Applying ${steps.length} statements (ai_embeddings) …\n`);
for (const [label, run] of steps) {
  try {
    await run();
    console.log("  ✓", label);
  } catch (e) {
    console.error("  ✗", label, "\n   ", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

const cols = (await sql`
  SELECT column_name, udt_name
  FROM information_schema.columns
  WHERE table_name = 'ai_embeddings'
  ORDER BY ordinal_position
`) as { column_name: string; udt_name: string }[];

console.log(`\nai_embeddings columns (${cols.length}):`);
for (const c of cols) console.log(`  ${c.column_name.padEnd(20)} ${c.udt_name}`);

const ok = cols.some((c) => c.column_name === "embedding" && c.udt_name === "vector");
console.log(ok ? "\n✓ ai_embeddings ready (vector column present)." : "\n✗ embedding vector column missing!");
process.exit(ok ? 0 : 1);
