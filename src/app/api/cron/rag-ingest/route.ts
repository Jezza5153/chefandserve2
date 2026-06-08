/**
 * GET /api/cron/rag-ingest — nightly re-index of the chunked notes-RAG store (`ai_embeddings`).
 *
 * WHY app-side and not a Railway worker: the ingestion engine reuses the shared, unit-tested
 * `src/lib/ai/rag/{redact,chunk,sources,ingest}` — but the Railway workers deploy `workers/`
 * standalone (own package-lock + node_modules, no `@/` alias, no `../src`), so a worker can't
 * import them and copying the pipeline would risk PII-redaction drift (forbidden by
 * docs/ai/rag-ingestion-contract.md). The Vercel app runtime has `ingestAll()` natively, so the
 * nightly trigger lives here. The per-row `embedding-refresh` worker still runs on Railway for
 * `*.semantic_search`.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. No CRON_SECRET set → 503
 * (refuses, so the route can't be triggered publicly). Idempotent (content-hash skip), so a
 * double-fire is harmless. Schedule lives in vercel.json (`0 3 * * *`).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { ingestAll } from "@/lib/ai/rag/ingest";

export const dynamic = "force-dynamic";
// Nightly deltas are fast (content-hash skip → mostly SELECTs); a full reindex embeds each
// changed chunk. Give it headroom (Vercel caps to the plan's max if lower).
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await ingestAll({ requestDelayMs: 25 });
    if (!result.enabled) {
      return NextResponse.json(
        { ok: true, enabled: false, note: "embeddings disabled (no OPENAI_API_KEY) — nothing indexed" },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { ok: true, enabled: true, durationMs: Date.now() - started, totals: result.totals, sources: result.sources },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ingestion failed" },
      { status: 500 },
    );
  }
}
