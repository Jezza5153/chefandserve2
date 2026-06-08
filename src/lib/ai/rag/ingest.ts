/**
 * RAG ingestion engine (docs/ai/rag-ingestion-contract.md §Refresh). For each allowlisted
 * source row: build text → REDACT (PII never reaches the vector) → density-gate → chunk →
 * embed (text-embedding-3-small) → soft-supersede the prior live chunks → insert. Idempotent:
 * a content hash (over the redacted text + redaction version) skips rows that haven't changed.
 *
 * neon-http has no interactive transactions, so supersede + insert are sequential atomic
 * statements. A crash mid-row leaves the old chunks superseded but un-replaced — self-healing
 * on the next run (the hash won't match "no live chunks", so it re-indexes).
 *
 * Reuses the SHARED, unit-tested redact()/chunkText() (smoke-ai-rag.mts) — never re-implements
 * redaction. Callable from a one-off script (scripts/rag-ingest.mts) or a worker.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { embedText, vectorLiteral, aiEmbeddingsEnabled } from "@/lib/ai/embeddings";
import { redact, isPiiDense, REDACTION_VERSION } from "@/lib/ai/rag/redact";
import { chunkText, chunkMarkdown } from "@/lib/ai/rag/chunk";
import { RAG_SOURCES, type RagSourceDef } from "@/lib/ai/rag/sources";

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown[] })?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function hashOf(text: string): string {
  return createHash("sha256").update(`v${REDACTION_VERSION}|${text}`).digest("hex");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SourceCounts = {
  id: string;
  rows: number;
  indexed: number; // chunks inserted
  superseded: number; // chunks soft-deleted
  unchanged: number; // rows skipped (content hash matched)
  skippedPiiDense: number; // rows skipped (>30% redacted)
  skippedEmpty: number; // rows whose buildText was empty
};

export type IngestResult = {
  enabled: boolean; // false → no OPENAI_API_KEY; nothing done
  sources: SourceCounts[];
  totals: { indexed: number; superseded: number; unchanged: number; skippedPiiDense: number };
};

type Opts = { onLog?: (msg: string) => void; requestDelayMs?: number; audit?: boolean };

async function liveHash(table: string, pk: string, field: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT content_hash FROM ai_embeddings
    WHERE source_table = ${table} AND source_pk = ${pk} AND field = ${field}
      AND superseded_at IS NULL
    LIMIT 1
  `);
  const row = rowsOf(res)[0];
  return row ? String(row.content_hash) : null;
}

async function supersede(table: string, pk: string, field: string): Promise<number> {
  const res = await db.execute(sql`
    UPDATE ai_embeddings SET superseded_at = now()
    WHERE source_table = ${table} AND source_pk = ${pk} AND field = ${field}
      AND superseded_at IS NULL
  `);
  // neon-http returns rowCount on the result object
  const rc = (res as { rowCount?: number; rowsAffected?: number })?.rowCount
    ?? (res as { rowsAffected?: number })?.rowsAffected
    ?? 0;
  return Number(rc) || 0;
}

async function insertChunk(args: {
  table: string;
  pk: string;
  field: string;
  chunkIndex: number;
  text: string;
  vec: number[];
  tenantScope: string;
  visibility: string;
  contentHash: string;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_embeddings
      (chunk_text, embedding, source_table, source_pk, field, chunk_index,
       tenant_scope, visibility, redaction_version, content_hash)
    VALUES
      (${args.text}, ${vectorLiteral(args.vec)}::vector, ${args.table}, ${args.pk}, ${args.field},
       ${args.chunkIndex}, ${args.tenantScope}, ${args.visibility}, ${REDACTION_VERSION}, ${args.contentHash})
  `);
}

async function ingestSource(def: RagSourceDef, opts: Opts): Promise<SourceCounts> {
  const log = opts.onLog ?? (() => {});
  const delay = opts.requestDelayMs ?? 50;
  const counts: SourceCounts = {
    id: def.id,
    rows: 0,
    indexed: 0,
    superseded: 0,
    unchanged: 0,
    skippedPiiDense: 0,
    skippedEmpty: 0,
  };

  const res = await db.execute(sql.raw(def.select));
  const rows = rowsOf(res);
  counts.rows = rows.length;

  for (const row of rows) {
    const pk = String(row.id);
    const raw = def.buildText(row);
    if (!raw.trim()) {
      counts.skippedEmpty++;
      continue;
    }

    const red = redact(raw);
    const newHash = hashOf(red.text);
    const existing = await liveHash(def.sourceTable, pk, def.field);

    // Dense PII → never index; clear any stale chunks so the corpus stays clean.
    if (isPiiDense(raw, red)) {
      if (existing) counts.superseded += await supersede(def.sourceTable, pk, def.field);
      counts.skippedPiiDense++;
      continue;
    }

    if (existing === newHash) {
      counts.unchanged++;
      continue;
    }

    const chunks = chunkText(red.text);
    if (chunks.length === 0) {
      counts.skippedEmpty++;
      continue;
    }

    // embed first; only supersede once we know the embeds succeed (minimise the empty window)
    const vectors: number[][] = [];
    let embedFailed = false;
    for (const c of chunks) {
      const vec = await embedText(c);
      if (!vec) {
        embedFailed = true;
        break;
      }
      vectors.push(vec);
      if (delay) await sleep(delay);
    }
    if (embedFailed) {
      log(`  ! embed failed for ${def.id}/${pk} — left existing chunks intact`);
      continue;
    }

    if (existing) counts.superseded += await supersede(def.sourceTable, pk, def.field);
    const tenantScope = def.tenantScope(row);
    for (let i = 0; i < chunks.length; i++) {
      await insertChunk({
        table: def.sourceTable,
        pk,
        field: def.field,
        chunkIndex: i,
        text: chunks[i],
        vec: vectors[i],
        tenantScope,
        visibility: def.visibility,
        contentHash: newHash,
      });
      counts.indexed++;
    }
  }

  log(
    `  ${def.id}: rows=${counts.rows} indexed=${counts.indexed} superseded=${counts.superseded} unchanged=${counts.unchanged} pii_dense=${counts.skippedPiiDense}`,
  );
  return counts;
}

/**
 * Ingest project docs (Broad-index per rag-source-catalog.md, but tagged tenant_scope=internal
 * + visibility=admin_only in V1 so chef/klant PAs never get architecture docs). Heading-aware
 * chunking. fs-free: the caller
 * (scripts/rag-ingest.mts) reads the files and passes {path, content} — the Vercel cron can't
 * reliably read repo files, so docs are re-indexed by the script on doc changes, not nightly.
 */
export async function ingestDocs(
  docs: Array<{ path: string; content: string }>,
  opts: Opts = {},
): Promise<SourceCounts> {
  const log = opts.onLog ?? (() => {});
  const delay = opts.requestDelayMs ?? 50;
  const counts: SourceCounts = {
    id: "docs",
    rows: docs.length,
    indexed: 0,
    superseded: 0,
    unchanged: 0,
    skippedPiiDense: 0,
    skippedEmpty: 0,
  };

  for (const doc of docs) {
    const sections = chunkMarkdown(doc.content);
    if (sections.length === 0) {
      counts.skippedEmpty++;
      continue;
    }
    // redact for safety (docs shouldn't carry PII, but never trust that) + hash the whole doc
    const redacted = sections.map((s) => ({ heading: s.heading, text: redact(s.text).text }));
    const newHash = hashOf(redacted.map((s) => s.text).join("\n"));
    const existing = await liveHash("docs", doc.path, "doc");
    if (existing === newHash) {
      counts.unchanged++;
      continue;
    }

    const vectors: number[][] = [];
    let embedFailed = false;
    for (const s of redacted) {
      const vec = await embedText(s.text);
      if (!vec) {
        embedFailed = true;
        break;
      }
      vectors.push(vec);
      if (delay) await sleep(delay);
    }
    if (embedFailed) {
      log(`  ! embed failed for doc ${doc.path} — left existing chunks intact`);
      continue;
    }

    if (existing) counts.superseded += await supersede("docs", doc.path, "doc");
    for (let i = 0; i < redacted.length; i++) {
      await insertChunk({
        table: "docs",
        pk: doc.path,
        field: "doc",
        chunkIndex: i,
        text: redacted[i].text,
        vec: vectors[i],
        tenantScope: "internal",
        visibility: "admin_only", // owner-only; 'internal' is a tenant_scope, NOT a visibility tier
        contentHash: newHash,
      });
      counts.indexed++;
    }
  }

  log(`  docs: files=${counts.rows} indexed=${counts.indexed} superseded=${counts.superseded} unchanged=${counts.unchanged}`);
  return counts;
}

/** Ingest every allowlisted source. No-op (enabled:false) when OPENAI_API_KEY is absent. */
export async function ingestAll(opts: Opts = {}): Promise<IngestResult> {
  const log = opts.onLog ?? (() => {});
  if (!aiEmbeddingsEnabled()) {
    log("OPENAI_API_KEY not set — skipping (embeddings disabled).");
    return { enabled: false, sources: [], totals: { indexed: 0, superseded: 0, unchanged: 0, skippedPiiDense: 0 } };
  }

  const sources: SourceCounts[] = [];
  for (const def of RAG_SOURCES) {
    sources.push(await ingestSource(def, opts));
  }

  const totals = sources.reduce(
    (acc, c) => ({
      indexed: acc.indexed + c.indexed,
      superseded: acc.superseded + c.superseded,
      unchanged: acc.unchanged + c.unchanged,
      skippedPiiDense: acc.skippedPiiDense + c.skippedPiiDense,
    }),
    { indexed: 0, superseded: 0, unchanged: 0, skippedPiiDense: 0 },
  );

  if (opts.audit !== false) {
    await db.execute(sql`
      INSERT INTO audit_log (action, resource, resource_id, after, created_at)
      VALUES ('ai.indexing_completed', 'ai_embeddings', NULL,
              ${JSON.stringify({ sources, totals, redactionVersion: REDACTION_VERSION })}, now())
    `);
  }

  return { enabled: true, sources, totals };
}
