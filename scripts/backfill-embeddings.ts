/**
 * ONE COMMAND to index everything the assistant should be able to recall semantically.
 * Run this the moment the OpenAI account has quota again:
 *
 *   npx tsx --env-file=<env> scripts/backfill-embeddings.ts            # dry: probe + counts
 *   npx tsx --env-file=<env> scripts/backfill-embeddings.ts --execute  # index for real
 *
 * WHY IT EXISTS. Two independent corpora feed the AI's recall and both were empty on
 * 2026-07-27 because the shared OpenAI account was out of quota:
 *   1. `ai_embeddings` — the notes/kennisbank corpus behind knowledge.search (built by
 *      ingestAll(), normally the nightly Vercel cron /api/cron/rag-ingest);
 *   2. `chefs.embedding` — the per-chef profile vector behind chefs.semantic_search
 *      (built by the Railway worker embedding-refresh, which silently runs in
 *      "observe" mode when the key is missing there).
 * The nightly jobs will get there on their own, but after a top-up you want the 215
 * chefs + 47 klanten indexed NOW, and you want a clear answer if it fails again.
 *
 * It PROBES the API first with one tiny embedding call, so an exhausted account fails in
 * one second with a plain message instead of thousands of retried 429s.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { ingestAll } from "@/lib/ai/rag/ingest";
import { env } from "@/lib/env";

const EXECUTE = process.argv.includes("--execute");

async function probe(): Promise<{ ok: boolean; detail: string }> {
  const key = env.OPENAI_API_KEY;
  if (!key) return { ok: false, detail: "geen OPENAI_API_KEY in deze omgeving" };
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: "probe" }),
    });
    if (res.ok) return { ok: true, detail: "API antwoordt" };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string } };
    return {
      ok: false,
      detail:
        res.status === 429
          ? `quota op (${body.error?.type ?? "insufficient_quota"}) — vul het OpenAI-account bij, dit is een facturatiekwestie, geen bug`
          : `HTTP ${res.status}: ${body.error?.message ?? "onbekende fout"}`,
    };
  } catch (e) {
    return { ok: false, detail: `netwerkfout: ${String(e).slice(0, 120)}` };
  }
}

async function counts() {
  const [c] = (await db.execute(sql`
    select
      (select count(*)::int from chefs where deleted_at is null) as chefs_total,
      (select count(embedding)::int from chefs where deleted_at is null) as chefs_embedded,
      (select count(*)::int from chefs where deleted_at is null and notes is not null and length(trim(notes)) > 0) as chefs_with_notes,
      (select count(*)::int from clients where deleted_at is null and notes is not null and length(trim(notes)) > 0) as clients_with_notes,
      (select count(*)::int from ai_embeddings) as chunks
  `).then((r) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])))) as {
    chefs_total: number; chefs_embedded: number; chefs_with_notes: number; clients_with_notes: number; chunks: number;
  }[];
  return c;
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);

  const before = await counts();
  console.log(
    `vooraf: ${before.chefs_embedded}/${before.chefs_total} chefs met profielvector · ` +
      `${before.chunks} kennisbank-fragmenten · te indexeren notities: ${before.chefs_with_notes} chef + ${before.clients_with_notes} klant`,
  );

  const p = await probe();
  console.log(`OpenAI: ${p.ok ? "✓" : "✗"} ${p.detail}`);
  if (!p.ok) {
    console.log("\nNiets geïndexeerd. De assistent blijft intussen werken via chefs.dossier/clients.dossier");
    console.log("en de trefwoord-fallback van knowledge.search — alleen zoeken-op-betekenis ligt stil.");
    process.exit(1);
  }
  if (!EXECUTE) {
    console.log("\nDry-run: API is bereikbaar. Draai opnieuw met --execute om te indexeren.");
    process.exit(0);
  }

  console.log("\nkennisbank indexeren (ingestAll)…");
  const res = await ingestAll();
  console.log(`  ${JSON.stringify(res)}`);

  const after = await counts();
  console.log(
    `\nna afloop: ${after.chefs_embedded}/${after.chefs_total} chefs met profielvector · ${after.chunks} fragmenten (+${after.chunks - before.chunks}).`,
  );
  console.log(
    after.chefs_embedded < after.chefs_total
      ? "Let op: de per-chef PROFIELvectoren komen van de Railway-worker embedding-refresh (03:00). Draait die in observe-mode, dan mist OPENAI_API_KEY op Railway — daar zetten, niet alleen op Vercel."
      : "Alle chefs hebben een profielvector.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
