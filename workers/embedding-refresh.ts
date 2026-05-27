/**
 * Embedding refresh — 3am daily.
 *
 * STATUS: STUB. The vector columns exist (Phase 9 prep migration applied)
 * but no LLM is wired yet. When ready:
 *   1. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to Railway env
 *   2. Uncomment the actual embedding call below
 *   3. Schedule this cron on Railway
 *
 * What it does (when live):
 *   - Computes a content hash for each chef / client / shift
 *   - For rows where embedded_text_hash != current hash → re-embed
 *   - Stores vector(1536) in the `embedding` column
 *
 * Cost projection: OpenAI text-embedding-3-small at $0.02 per 1M tokens.
 * Each chef profile ~200 tokens → ~$4 for 1M chef embeddings. Negligible.
 */
import { createHash } from "node:crypto";

import { sql, audit, log } from "./_lib";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Build the text we'll embed for a chef. */
function chefText(c: {
  full_name: string;
  vakniveau: string | null;
  segments: string[] | null;
  specialties: string | null;
  city: string | null;
  years_experience: number | null;
  languages: string[] | null;
  notes: string | null;
}): string {
  return [
    `Naam: ${c.full_name}`,
    c.vakniveau ? `Vakniveau: ${c.vakniveau}` : null,
    c.segments?.length ? `Segmenten: ${c.segments.join(", ")}` : null,
    c.specialties ? `Specialties: ${c.specialties}` : null,
    c.city ? `Stad: ${c.city}` : null,
    c.years_experience ? `Ervaring: ${c.years_experience} jaar` : null,
    c.languages?.length ? `Talen: ${c.languages.join(", ")}` : null,
    c.notes ? `Notes: ${c.notes}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

async function getEmbedding(_text: string): Promise<number[] | null> {
  // PHASE 9 ACTUAL CALL — gated behind OPENAI_API_KEY presence
  // const apiKey = process.env.OPENAI_API_KEY;
  // if (!apiKey) return null;
  // const r = await fetch("https://api.openai.com/v1/embeddings", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: `Bearer ${apiKey}`,
  //   },
  //   body: JSON.stringify({
  //     model: "text-embedding-3-small",
  //     input: text,
  //   }),
  // });
  // const data = await r.json();
  // return data.data?.[0]?.embedding ?? null;
  return null; // stub
}

async function main() {
  log("embedding-refresh start (STUB MODE)");

  if (!process.env.OPENAI_API_KEY) {
    log("OPENAI_API_KEY not set — stub mode, no embeddings computed");
    log(
      "When ready: set the env var + uncomment the actual call in getEmbedding()",
    );
  }

  // Find chefs that need re-embedding
  const chefs = await sql`
    SELECT id, full_name, vakniveau, segments, specialties, city,
           years_experience, languages, notes, embedded_text_hash
    FROM chefs
    WHERE deleted_at IS NULL
  ` as Array<{
    id: string;
    full_name: string;
    vakniveau: string | null;
    segments: string[] | null;
    specialties: string | null;
    city: string | null;
    years_experience: number | null;
    languages: string[] | null;
    notes: string | null;
    embedded_text_hash: string | null;
  }>;

  let stale = 0;
  let updated = 0;
  for (const chef of chefs) {
    const text = chefText(chef);
    const hash = contentHash(text);
    if (chef.embedded_text_hash === hash) continue;
    stale++;

    const vec = await getEmbedding(text);
    if (!vec) continue; // stub — no embedding service wired

    // Phase 9 actual write:
    // await sql`
    //   UPDATE chefs
    //   SET embedding = ${vec}::vector, embedded_text_hash = ${hash}, embedded_at = now()
    //   WHERE id = ${chef.id}
    // `;
    updated++;
  }

  log(`Chefs scanned: ${chefs.length}, stale: ${stale}, updated: ${updated}`);

  // (Same logic for clients + shifts would go here)

  await audit("worker.embedding_refresh", "system", null, {
    chefs_scanned: chefs.length,
    chefs_stale: stale,
    chefs_updated: updated,
    mode: process.env.OPENAI_API_KEY ? "live" : "STUB",
  });

  process.exit(0);
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
