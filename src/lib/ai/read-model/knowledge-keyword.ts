/**
 * Keyword fallback for the kennisbank — what the assistant uses when the SEMANTIC path
 * has nothing to offer.
 *
 * WHY THIS EXISTS. `knowledge.search` retrieves over `ai_embeddings`; that corpus is
 * empty whenever embeddings are off, the nightly ingest hasn't run, or (the live case
 * on 2026-07-27) the OpenAI account is out of quota. The tool then answered "kennisbank-
 * zoeken is nu niet beschikbaar" while 213 chef- and 47 klant-notities sat in Postgres,
 * fully readable. A degraded keyword answer beats a confident "niet beschikbaar".
 *
 * SAME CONTRACT AS THE RAG PATH:
 * - the same sources (chefs.notes / clients.notes / contact_logs), so a hit here is a
 *   hit there once the corpus is built;
 * - the same redaction (`redact()`) applied to every snippet before it leaves this
 *   module — the raw columns hold e-mail/telefoon/IBAN that must never reach the model;
 * - admin-only visibility: these sources are `admin_only` in rag/sources.ts, so this
 *   fallback is called from the OWNER path only (searchKnowledgeForOwner).
 *
 * It is a fallback, not a replacement: no ranking by meaning, only ILIKE + recency.
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

/** Chars of context kept around the first match — enough to judge, short enough to scan. */
const WINDOW = 260;

/** The match plus surrounding context, redacted. Falls back to the head of the text. */
function excerpt(text: string, term: string): string {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(WINDOW / 3));
  const raw = text.slice(start, start + WINDOW).replace(/\s+/g, " ").trim();
  const { text: safe } = redact(raw);
  return `${start > 0 ? "…" : ""}${safe}${start + WINDOW < text.length ? "…" : ""}`;
}

/**
 * ILIKE over the notes corpus. `query` is used verbatim as a substring — the caller's
 * free text, not a parsed expression; % and _ are escaped so a stray character can't
 * turn into a wildcard scan.
 */
export async function searchKnowledgeByKeyword(query: string, limit: number): Promise<KeywordHit[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const cap = Math.min(Math.max(limit, 1), 20);

  const rows = (await db.execute(sql`
    (
      select 'chefs' as src, c.id::text as pk, 'notes' as field,
             'Notitie over chef ' || c.full_name as label, c.notes as body, c.updated_at as at
      from chefs c
      where c.deleted_at is null and c.notes ilike ${like}
    )
    union all
    (
      select 'clients', cl.id::text, 'notes',
             'Notitie over klant ' || cl.company_name, cl.notes, cl.updated_at
      from clients cl
      where cl.deleted_at is null and cl.notes ilike ${like}
    )
    union all
    (
      select 'contact_logs', l.id::text, 'note', 'Contactnotitie', l.note, l.created_at
      from contact_logs l
      where l.note ilike ${like}
    )
    order by at desc nulls last
    limit ${cap}
  `)) as unknown;

  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as {
    src: string;
    pk: string;
    field: string;
    label: string;
    body: string | null;
  }[];

  return list
    .filter((r) => r.body)
    .map((r) => ({
      sourceLabel: r.label,
      source: `${r.src}:${r.pk}`,
      field: r.field,
      snippet: excerpt(r.body!, term),
    }));
}
