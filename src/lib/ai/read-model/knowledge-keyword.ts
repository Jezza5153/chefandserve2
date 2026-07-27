/**
 * Keyword fallback for the kennisbank — what the assistant uses when the SEMANTIC path
 * has nothing to offer.
 *
 * WHY THIS EXISTS. `knowledge.search` retrieves over `ai_embeddings`; that corpus is
 * empty whenever embeddings are off, the nightly ingest hasn't run, or (the live case
 * on 2026-07-27) the OpenAI account is out of quota. The tool then answered "kennisbank-
 * zoeken is nu niet beschikbaar" while 213 chef- and 46 klant-notities sat in Postgres,
 * fully readable. A degraded keyword answer beats a confident "niet beschikbaar".
 *
 * FOUR RULES THIS MODULE MUST KEEP (each one is a bug an Opus review found in v1):
 *  1. REDACT BEFORE WINDOWING. Slicing a 260-char excerpt first and redacting the slice
 *     lets an e-mail or IBAN that straddles the cut escape every anchored pattern. Redact
 *     the whole column, then locate the term inside the redacted text.
 *  2. SCOPE BY PERMISSION. chef notes and klant notes are separate grants: a planner has
 *     chefs.read but not necessarily clients.read, and this tool's single gate can't
 *     express that — so the caller passes what it may see and each branch is opt-in.
 *  3. HONOUR THE ART. 17 ERASURE. The RAG purge deletes an erased subject's chunks
 *     (rag/purge.ts), but contact_logs rows survive the erasure. Reading them live would
 *     resurrect exactly what the purge removed, so every branch joins its subject and
 *     skips soft-deleted ones.
 *  4. MATCH PER WORD. The brain sends meaning-shaped queries ("allergieën en speciale
 *     wensen"); one contiguous ILIKE over that phrase matches nothing. Tokenise and
 *     require every token (AND), which is the closest honest approximation of intent.
 *
 * It is a fallback, not a replacement: no ranking by meaning, only recency.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { redact } from "@/lib/ai/rag/redact";

export type KeywordHit = {
  sourceLabel: string;
  source: string;
  field: string;
  snippet: string;
};

export type KeywordScope = {
  /** Caller may read chef notes (permission chefs.read). */
  chefs: boolean;
  /** Caller may read klant notes + contact logs (permission clients.read). */
  clients: boolean;
};

/** Chars of context kept around the first match — enough to judge, short enough to scan. */
const WINDOW = 260;
/** Words shorter than this are noise ("de", "of") and would match everything. */
const MIN_TOKEN = 3;
const STOPWORDS = new Set([
  "wat", "wie", "waar", "hoe", "over", "van", "voor", "met", "een", "het", "de", "der",
  "den", "die", "dat", "deze", "onze", "ons", "bij", "aan", "heb", "hebben", "heeft",
  "genoteerd", "afgesproken", "weten", "weet", "and", "the", "for", "about",
]);

export function tokenise(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}+]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length >= MIN_TOKEN && !STOPWORDS.has(w)),
  )].slice(0, 6); // a 7th term adds latency, never recall
}

/** The match plus surrounding context — taken from the ALREADY-redacted text (rule 1). */
function excerpt(safeText: string, tokens: string[]): string {
  const lower = safeText.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(WINDOW / 3));
  const body = safeText.slice(start, start + WINDOW).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${start + WINDOW < safeText.length ? "…" : ""}`;
}

/**
 * ILIKE over the notes corpus, one condition per token (AND). Tokens are escaped, so a
 * stray % or _ from the user's phrasing can't turn into a wildcard scan.
 */
export async function searchKnowledgeByKeyword(
  query: string,
  limit: number,
  scope: KeywordScope,
): Promise<KeywordHit[]> {
  const tokens = tokenise(query);
  if (tokens.length === 0 || (!scope.chefs && !scope.clients)) return [];
  // Two stages: ALL tokens first (precise), then ANY token when that finds nothing.
  // Strict AND alone turns "allergieën en speciale wensen" into a false negative for a
  // note that only says "allergieën" — and a near-miss beats a confident "niets gevonden".
  const strict = await runKeyword(tokens, limit, scope, "and");
  return strict.length > 0 ? strict : runKeyword(tokens, limit, scope, "or");
}

async function runKeyword(
  tokens: string[],
  limit: number,
  scope: KeywordScope,
  mode: "and" | "or",
): Promise<KeywordHit[]> {
  const cap = Math.min(Math.max(limit, 1), 20);
  const likes = tokens.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const allOf = (col: ReturnType<typeof sql>) =>
    sql`(${sql.join(likes.map((l) => sql`${col} ilike ${l}`), mode === "and" ? sql` and ` : sql` or `)})`;

  const parts = [];
  if (scope.chefs) {
    parts.push(sql`
      select 'chefs' as src, c.id::text as pk, 'notes' as field,
             'Notitie over chef ' || c.full_name as label, c.notes as body, c.updated_at as at
      from chefs c
      where c.deleted_at is null and c.notes is not null and ${allOf(sql`c.notes`)}`);
  }
  if (scope.clients) {
    parts.push(sql`
      select 'clients', cl.id::text, 'notes',
             'Notitie over klant ' || cl.company_name, cl.notes, cl.updated_at
      from clients cl
      where cl.deleted_at is null and cl.notes is not null and ${allOf(sql`cl.notes`)}`);
    // contact_logs: only when the subject still exists. The art. 17 erasure blanks the
    // chef/klant row and purges the embeddings but leaves these rows behind (rule 3).
    parts.push(sql`
      select 'contact_logs', l.id::text, 'note', 'Contactnotitie', l.note, l.created_at
      from contact_logs l
      where ${allOf(sql`l.note`)}
        and (
          (l.target_type = 'chef'   and exists (select 1 from chefs   x where x.id = l.target_id and x.deleted_at is null))
          or
          (l.target_type = 'client' and exists (select 1 from clients y where y.id = l.target_id and y.deleted_at is null))
        )`);
  }

  const rows = (await db.execute(sql`
    ${sql.join(parts, sql` union all `)}
    order by at desc nulls last
    limit ${cap}
  `)) as unknown;

  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as {
    src: string; pk: string; field: string; label: string; body: string | null;
  }[];

  return list
    .filter((r) => r.body)
    .map((r) => {
      const { text: safe } = redact(r.body!); // rule 1: redact the WHOLE column first
      return { sourceLabel: r.label, source: `${r.src}:${r.pk}`, field: r.field, snippet: excerpt(safe, tokens) };
    });
}
