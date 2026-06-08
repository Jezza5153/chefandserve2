/**
 * RAG ingestion — index every allowlisted source (chef/klant/dienst-notities + contactlogs)
 * into ai_embeddings: redact → density-gate → chunk → embed → soft-supersede + insert.
 *   npx tsx --env-file=.env.local scripts/rag-ingest.mts
 * Idempotent (content-hash skip). Needs OPENAI_API_KEY + DATABASE_URL. Run after the
 * apply-ai-embeddings migration; safe to re-run any time (the nightly worker will do the same).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { ingestAll } = await import("@/lib/ai/rag/ingest");

console.log("=== RAG ingestion ===\n");
const result = await ingestAll({ onLog: (m) => console.log(m) });

if (!result.enabled) {
  console.log("\n✗ embeddings disabled (no OPENAI_API_KEY) — nothing indexed.");
  process.exit(1);
}

console.log(
  `\n=== totals: ${result.totals.indexed} chunks indexed · ${result.totals.superseded} superseded · ` +
    `${result.totals.unchanged} unchanged · ${result.totals.skippedPiiDense} skipped (PII-dense) ===`,
);
process.exit(0);
