/**
 * RAG ingestion — index every allowlisted source into ai_embeddings: redact → density-gate →
 * chunk → embed → soft-supersede + insert. Two passes:
 *   1. DB sources (chef/klant/dienst-notities + contactlogs) via ingestAll() — also the nightly
 *      Vercel cron's job (GET /api/cron/rag-ingest).
 *   2. Project docs (MEMORY/WORKFLOW/AI_INTEGRATION/README + docs/ai/*.md) via ingestDocs() —
 *      SCRIPT-ONLY (the Vercel cron can't reliably read repo files), re-run on doc changes.
 *
 *   npx tsx --env-file=.env.local scripts/rag-ingest.mts
 * Idempotent (content-hash skip). Needs OPENAI_API_KEY + DATABASE_URL.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";
config({ path: ".env.local" });

const { ingestAll, ingestDocs } = await import("@/lib/ai/rag/ingest");

console.log("=== RAG ingestion ===\n");
console.log("── DB sources ──");
const result = await ingestAll({ onLog: (m) => console.log(m) });

if (!result.enabled) {
  console.log("\n✗ embeddings disabled (no OPENAI_API_KEY) — nothing indexed.");
  process.exit(1);
}

console.log("\n── project docs ──");
const docPaths: string[] = [];
for (const p of ["MEMORY.md", "WORKFLOW.md", "AI_INTEGRATION.md", "README.md", "CLAUDE.md"]) {
  if (existsSync(p)) docPaths.push(p);
}
if (existsSync("docs/ai")) {
  for (const f of readdirSync("docs/ai")) if (f.endsWith(".md")) docPaths.push(join("docs/ai", f));
}
const docs = docPaths.map((p) => ({ path: p, content: readFileSync(p, "utf8") }));
const docCounts = await ingestDocs(docs, { onLog: (m) => console.log(m) });

// Note: chef CVs are indexed inside ingestAll() above (the `cv:` line) — they ride the cron too.
console.log(
  `\n=== totals — DB sources + CVs: ${result.totals.indexed} chunks indexed · ${result.totals.unchanged} unchanged · ${result.totals.skippedPiiDense} skipped(PII) ` +
    `| docs: ${docCounts.indexed} indexed · ${docCounts.unchanged} unchanged (${docPaths.length} files) ===`,
);
process.exit(0);
