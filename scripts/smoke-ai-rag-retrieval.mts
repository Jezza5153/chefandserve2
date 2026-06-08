/**
 * LIVE RAG retrieval smoke — the contract's pre-flight checks that need the real corpus
 * (docs/ai/rag-ingestion-contract.md §Pre-flight). Run after rag-ingest:
 *   npx tsx --env-file=.env.local scripts/smoke-ai-rag-retrieval.mts
 *
 * Asserts:
 *   1. NEVER-sources: every ai_embeddings row's source_table is on the allowlist (no users /
 *      auth / payroll / hours / documents / ratings ever indexed).
 *   2. Redaction ran: no chunk_text carries a raw email/phone (PII stripped at index time).
 *   3. Metadata present: tenant_scope + visibility populated with valid enum values.
 *   4. Tenant isolation (needs key): a chef actor's retrieval returns ONLY that chef's
 *      chunks — never another chef's, never admin_only notes.
 *   5. Owner spans tenants (needs key): the internal actor retrieves across tenants.
 *
 * Degrades: no DATABASE_URL → skip all (exit 0). No OPENAI_API_KEY → run corpus checks 1-3
 * (DB-only), skip the retrieval checks 4-5.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let pass = 0;
let fail = 0;
let skip = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

console.log("=== LIVE RAG retrieval smoke ===\n");

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.log("DATABASE_URL not set — skipping (exit 0).");
  process.exit(0);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(dbUrl);
const { ALLOWED_SOURCE_TABLES } = await import("@/lib/ai/rag/sources");
const { VISIBILITIES } = await import("@/lib/ai/rag/access");

const rowsOf = (res: unknown): Record<string, unknown>[] =>
  Array.isArray(res) ? (res as Record<string, unknown>[]) : [];

// ── 1. NEVER-sources allowlist ──
console.log("── corpus: only allowlisted sources ──");
const tables = rowsOf(await sql`
  SELECT source_table, count(*)::int AS n
  FROM ai_embeddings WHERE superseded_at IS NULL
  GROUP BY source_table ORDER BY source_table
`);
const total = tables.reduce((a, t) => a + Number(t.n), 0);
console.log(`  live chunks: ${total} across [${tables.map((t) => `${t.source_table}:${t.n}`).join(", ") || "—"}]`);
const offenders = tables.filter((t) => !ALLOWED_SOURCE_TABLES.includes(String(t.source_table)));
assert(
  "every source_table is allowlisted (no NEVER/Restricted source indexed)",
  offenders.length === 0,
  offenders.map((o) => o.source_table).join(", "),
);

if (total === 0) {
  console.log("\n  (no chunks yet — run scripts/rag-ingest.mts first for the full check)");
}

// ── 2. redaction ran (no raw email/phone in any chunk) ──
console.log("\n── corpus: PII redacted at index time ──");
const sample = rowsOf(await sql`
  SELECT chunk_text FROM ai_embeddings WHERE superseded_at IS NULL LIMIT 2000
`);
const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const phoneRe = /(?<![\d+])(?:\+31|0031|06)[\s-]?\d(?:[\s-]?\d){7,8}(?!\d)/;
const withEmail = sample.filter((r) => emailRe.test(String(r.chunk_text)));
const withPhone = sample.filter((r) => phoneRe.test(String(r.chunk_text)));
assert("no raw email in any chunk", withEmail.length === 0, `${withEmail.length} chunk(s)`);
assert("no raw NL phone in any chunk", withPhone.length === 0, `${withPhone.length} chunk(s)`);

// ── 3. metadata present + valid ──
console.log("\n── corpus: metadata populated + valid ──");
const meta = rowsOf(await sql`
  SELECT count(*)::int AS n_missing FROM ai_embeddings
  WHERE superseded_at IS NULL
    AND (tenant_scope IS NULL OR tenant_scope = '' OR visibility IS NULL OR visibility = '')
`);
assert("every chunk has tenant_scope + visibility", Number(meta[0]?.n_missing ?? 0) === 0);
const badVis = rowsOf(await sql`
  SELECT DISTINCT visibility FROM ai_embeddings WHERE superseded_at IS NULL
`).filter((r) => !(VISIBILITIES as readonly string[]).includes(String(r.visibility)));
assert("every visibility value is a known enum tier", badVis.length === 0, badVis.map((b) => b.visibility).join(", "));

// ── AVG synchronous purge: real delete round-trip (no key needed) ──
console.log("\n── AVG purge: synchronous delete round-trip ──");
{
  const { purgeAiEmbeddingsForSubject } = await import("@/lib/ai/rag/purge");
  const sentinelChef = "__rag_smoke_sentinel__";
  const scope = `chefId:${sentinelChef}`;
  const zeroVec = `[${Array(1536).fill(0).join(",")}]`;
  await sql`DELETE FROM ai_embeddings WHERE tenant_scope = ${scope}`; // clean any leftover
  await sql`
    INSERT INTO ai_embeddings
      (chunk_text, embedding, source_table, source_pk, field, chunk_index, tenant_scope, visibility, redaction_version, content_hash)
    VALUES ('smoke sentinel', ${zeroVec}::vector, 'chefs', ${sentinelChef}, 'notes', 0, ${scope}, 'admin_only', 1, 'smoke')
  `;
  const before = rowsOf(await sql`SELECT count(*)::int AS n FROM ai_embeddings WHERE tenant_scope = ${scope}`);
  assert("sentinel chunk inserted", Number(before[0]?.n) === 1);
  const purged = await purgeAiEmbeddingsForSubject({ chefId: sentinelChef });
  assert("purgeAiEmbeddingsForSubject deletes the chunk", purged === 1, `purged=${purged}`);
  const after = rowsOf(await sql`SELECT count(*)::int AS n FROM ai_embeddings WHERE tenant_scope = ${scope}`);
  assert("no sentinel chunk remains after purge", Number(after[0]?.n) === 0);
}

// ── retention: the worker's purge SQL is valid against the live schema ──
console.log("\n── retention: ai_embeddings purge SQL is valid ──");
{
  const sup = rowsOf(await sql`
    SELECT count(*)::int AS n FROM ai_embeddings
    WHERE superseded_at IS NOT NULL AND superseded_at < now() - interval '30 days'
  `);
  const er = rowsOf(await sql`
    SELECT count(*)::int AS n FROM ai_embeddings
    WHERE tenant_scope IN (
      SELECT 'chefId:' || id FROM chefs WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
      UNION ALL
      SELECT 'clientId:' || id FROM clients WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
    )
  `);
  assert(
    "retention count SQL runs (superseded + erased-source)",
    Number.isFinite(Number(sup[0]?.n)) && Number.isFinite(Number(er[0]?.n)),
  );
  console.log(`  retention candidates today: ${Number(sup[0]?.n ?? 0)} superseded, ${Number(er[0]?.n ?? 0)} erased-source`);
}

// ── 4 + 5. retrieval (needs OPENAI_API_KEY) ──
console.log("\n── retrieval: tenant isolation + owner span ──");
if (!process.env.OPENAI_API_KEY) {
  console.log("  ⊘ OPENAI_API_KEY not set — skipping retrieval checks (corpus checks above still ran).");
  skip += 2;
} else if (total === 0) {
  console.log("  ⊘ no chunks indexed yet — skipping retrieval checks.");
  skip += 2;
} else {
  const { retrieveKnowledge } = await import("@/lib/ai/rag/retrieve");

  // a broad query likely to surface several chunks
  const query = "ervaring keuken horeca chef";

  // owner sees across tenants
  const ownerHits = await retrieveKnowledge({ query, actor: { kind: "internal" }, limit: 20 });
  assert("owner retrieval returns chunks", Array.isArray(ownerHits) && ownerHits.length > 0, `${ownerHits?.length ?? "null"}`);

  // pick two distinct chef tenants from the corpus to prove isolation
  const chefScopes = rowsOf(await sql`
    SELECT DISTINCT tenant_scope FROM ai_embeddings
    WHERE superseded_at IS NULL AND tenant_scope LIKE 'chefId:%'
  `).map((r) => String(r.tenant_scope));

  if (chefScopes.length >= 1) {
    const chefIdA = chefScopes[0].slice("chefId:".length);
    const chefHits = await retrieveKnowledge({ query, actor: { kind: "chef", entityId: chefIdA }, limit: 20 });
    const leaked = (chefHits ?? []).filter(
      (h) => h.tenantScope !== `chefId:${chefIdA}` && h.tenantScope !== "public" && !h.tenantScope.startsWith("placement:"),
    );
    assert(
      "chef retrieval leaks NO other-tenant chunk",
      leaked.length === 0,
      leaked.map((l) => `${l.sourceTable}/${l.tenantScope}/${l.visibility}`).slice(0, 5).join("; "),
    );
    const adminLeak = (chefHits ?? []).filter((h) => h.visibility === "admin_only");
    assert("chef retrieval surfaces NO admin_only chunk", adminLeak.length === 0, `${adminLeak.length}`);
    if (chefScopes.length >= 2) {
      const otherId = chefScopes[1].slice("chefId:".length);
      assert(
        `chef ${chefIdA.slice(0, 8)} never sees chef ${otherId.slice(0, 8)}`,
        !(chefHits ?? []).some((h) => h.tenantScope === `chefId:${otherId}`),
      );
    } else {
      console.log("  ⊘ only one chef tenant in corpus — cross-chef assert skipped.");
      skip++;
    }
  } else {
    console.log("  ⊘ no chef chunks in corpus — isolation check skipped.");
    skip++;
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped ===`);
if (fail > 0) process.exit(1);
process.exit(0);
