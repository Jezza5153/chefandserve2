/**
 * Embedding refresh — runs daily on Railway.
 *
 * What it does:
 *   - Computes a content hash for each chef / client / shift
 *   - For rows where `embedded_text_hash != current hash` → re-embed
 *   - Stores vector(1536) in the `embedding` column
 *   - Updates `embedded_text_hash` + `embedded_at`
 *
 * Activation:
 *   - Set `OPENAI_API_KEY` on the Railway service.
 *   - Without the key, this worker runs in OBSERVE mode: it counts stale
 *     rows and writes an audit entry, but makes no API calls and no writes.
 *
 * Cost guidance:
 *   - Model: text-embedding-3-small, dim 1536, $0.02 per 1M input tokens.
 *   - A chef profile ~200 tokens → ~$4 for 1M embeddings. Negligible.
 *
 * Safety:
 *   - Soft-deleted rows skipped (deleted_at IS NULL filter).
 *   - Past shifts skipped (matching is forward-looking only).
 *   - Rate-limited via REQUEST_DELAY_MS so we don't hammer OpenAI.
 *   - Idempotent: only embeds rows whose content actually changed.
 */
import { createHash } from "node:crypto";

import { sql, audit, log } from "./_lib";

/* ----- config ------------------------------------------------------------ */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const REQUEST_DELAY_MS = 50; // ~20 req/s — well below OpenAI's tier-1 limit
const BATCH_LOG_EVERY = 25;

/* ----- text builders ----------------------------------------------------- */

type ChefRow = {
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
};

type ClientRow = {
  id: string;
  company_name: string;
  segment: string | null;
  city: string | null;
  notes: string | null;
  embedded_text_hash: string | null;
};

type ShiftRow = {
  id: string;
  when_description: string | null;
  role_needed: string;
  segment: string | null;
  starts_at: Date;
  location: string | null;
  city: string | null;
  notes: string | null;
  embedded_text_hash: string | null;
  client_name: string | null;
};

function chefText(c: ChefRow): string {
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

function clientText(c: ClientRow): string {
  return [
    `Bedrijf: ${c.company_name}`,
    c.segment ? `Segment: ${c.segment}` : null,
    c.city ? `Stad: ${c.city}` : null,
    c.notes ? `Notes: ${c.notes}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

function shiftText(s: ShiftRow): string {
  return [
    s.client_name ? `Klant: ${s.client_name}` : null,
    `Rol: ${s.role_needed}`,
    s.segment ? `Segment: ${s.segment}` : null,
    `Wanneer: ${new Date(s.starts_at).toLocaleDateString("nl-NL")}`,
    s.when_description ? `Periode: ${s.when_description}` : null,
    s.location || s.city ? `Locatie: ${[s.location, s.city].filter(Boolean).join(", ")}` : null,
    s.notes ? `Notes: ${s.notes}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/* ----- OpenAI call ------------------------------------------------------- */

async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    log(`OpenAI ${r.status}: ${body.slice(0, 200)}`);
    return null;
  }

  const data = (await r.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = data.data?.[0]?.embedding;
  if (!vec || vec.length !== EMBEDDING_DIM) return null;
  return vec;
}

/** pgvector accepts a string like `[0.1,0.2,...]` for vector input. */
function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ----- processors -------------------------------------------------------- */

async function processChefs(observeOnly: boolean) {
  const rows = (await sql`
    SELECT id, full_name, vakniveau, segments, specialties, city,
           years_experience, languages, notes, embedded_text_hash
    FROM chefs
    WHERE deleted_at IS NULL
  `) as ChefRow[];

  let stale = 0;
  let updated = 0;
  for (const row of rows) {
    const text = chefText(row);
    const hash = contentHash(text);
    if (row.embedded_text_hash === hash) continue;
    stale++;

    if (observeOnly) continue;

    const vec = await getEmbedding(text);
    if (!vec) continue;

    await sql`
      UPDATE chefs
      SET embedding = ${vectorLiteral(vec)}::vector,
          embedded_text_hash = ${hash},
          embedded_at = now()
      WHERE id = ${row.id}
    `;
    updated++;
    if (updated % BATCH_LOG_EVERY === 0) log(`  chefs: ${updated} embedded`);
    await sleep(REQUEST_DELAY_MS);
  }
  return { scanned: rows.length, stale, updated };
}

async function processClients(observeOnly: boolean) {
  const rows = (await sql`
    SELECT id, company_name, segment, city, notes, embedded_text_hash
    FROM clients
    WHERE deleted_at IS NULL
  `) as ClientRow[];

  let stale = 0;
  let updated = 0;
  for (const row of rows) {
    const text = clientText(row);
    const hash = contentHash(text);
    if (row.embedded_text_hash === hash) continue;
    stale++;

    if (observeOnly) continue;

    const vec = await getEmbedding(text);
    if (!vec) continue;

    await sql`
      UPDATE clients
      SET embedding = ${vectorLiteral(vec)}::vector,
          embedded_text_hash = ${hash},
          embedded_at = now()
      WHERE id = ${row.id}
    `;
    updated++;
    if (updated % BATCH_LOG_EVERY === 0) log(`  clients: ${updated} embedded`);
    await sleep(REQUEST_DELAY_MS);
  }
  return { scanned: rows.length, stale, updated };
}

async function processShifts(observeOnly: boolean) {
  // Forward-looking only — past shifts don't need embeddings for matching.
  // Shifts don't have soft-delete; cancelled shifts are excluded via status.
  const rows = (await sql`
    SELECT s.id, s.when_description, s.role_needed, s.segment, s.starts_at,
           s.location, s.city, s.notes, s.embedded_text_hash,
           c.company_name AS client_name
    FROM shifts s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.starts_at >= now()
      AND s.status != 'cancelled'
  `) as ShiftRow[];

  let stale = 0;
  let updated = 0;
  for (const row of rows) {
    const text = shiftText(row);
    const hash = contentHash(text);
    if (row.embedded_text_hash === hash) continue;
    stale++;

    if (observeOnly) continue;

    const vec = await getEmbedding(text);
    if (!vec) continue;

    await sql`
      UPDATE shifts
      SET embedding = ${vectorLiteral(vec)}::vector,
          embedded_text_hash = ${hash},
          embedded_at = now()
      WHERE id = ${row.id}
    `;
    updated++;
    if (updated % BATCH_LOG_EVERY === 0) log(`  shifts: ${updated} embedded`);
    await sleep(REQUEST_DELAY_MS);
  }
  return { scanned: rows.length, stale, updated };
}

/* ----- main -------------------------------------------------------------- */

async function main() {
  const observeOnly = !process.env.OPENAI_API_KEY;
  log(`embedding-refresh start (${observeOnly ? "OBSERVE — no key" : "LIVE"})`);

  const chefStats = await processChefs(observeOnly);
  log(`chefs: scanned=${chefStats.scanned} stale=${chefStats.stale} updated=${chefStats.updated}`);

  const clientStats = await processClients(observeOnly);
  log(`clients: scanned=${clientStats.scanned} stale=${clientStats.stale} updated=${clientStats.updated}`);

  const shiftStats = await processShifts(observeOnly);
  log(`shifts: scanned=${shiftStats.scanned} stale=${shiftStats.stale} updated=${shiftStats.updated}`);

  await audit("worker.embedding_refresh", "system", null, {
    mode: observeOnly ? "observe" : "live",
    chefs: chefStats,
    clients: clientStats,
    shifts: shiftStats,
  });

  if (observeOnly && (chefStats.stale + clientStats.stale + shiftStats.stale) > 0) {
    log(
      `↳ ${chefStats.stale + clientStats.stale + shiftStats.stale} rows are stale; ` +
      `set OPENAI_API_KEY on Railway to start embedding them.`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
