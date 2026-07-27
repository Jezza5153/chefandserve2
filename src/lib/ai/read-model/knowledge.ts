/**
 * Owner-facing knowledge search — wraps the RAG retriever for the (owner-only) assistant and
 * turns raw chunks into human citations ("Notitie over chef Lisa de Vries"), never raw
 * source_table:pk robot codes in the headline. Still carries the machine `source` so the brain
 * can cite + the answer traces back to a canonical row (contract §Retrieval rule 5).
 *
 * V1 caller is always the owner → actor {kind:'internal'}. When chef/klant PAs ship they call
 * retrieveKnowledge directly with their own actor; this shaper stays owner-specific.
 */
import { inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, shifts } from "@/lib/db/schema";
import { retrieveKnowledge, type RetrievedChunk } from "@/lib/ai/rag/retrieve";
import { searchKnowledgeByKeyword, type KeywordScope } from "@/lib/ai/read-model/knowledge-keyword";

export type KnowledgeHit = {
  sourceLabel: string; // human headline, e.g. "Notitie over chef Lisa de Vries"
  source: string; // machine cite, e.g. "chefs:<uuid>"
  field: string;
  snippet: string; // the redacted chunk text
  /** 0..100 on the semantic path; null on the keyword path — there is no similarity
   *  there, and a literal 0 reads to the brain as "matched terribly". */
  similarityPct: number | null;
};

export type KnowledgeSearchResult =
  | { available: false }
  | { available: true; count: number; hits: KnowledgeHit[]; via: "semantisch" | "trefwoord" };

const uniq = (xs: string[]) => [...new Set(xs)];

async function resolveNames(hits: RetrievedChunk[]) {
  const chefIds = uniq(hits.filter((h) => h.sourceTable === "chefs").map((h) => h.sourcePk));
  const clientIds = uniq(hits.filter((h) => h.sourceTable === "clients").map((h) => h.sourcePk));
  const shiftIds = uniq(hits.filter((h) => h.sourceTable === "shifts").map((h) => h.sourcePk));

  const chefName = new Map<string, string>();
  const clientName = new Map<string, string>();
  const shiftClient = new Map<string, string | null>();

  if (chefIds.length) {
    const rows = await db.select({ id: chefs.id, name: chefs.fullName }).from(chefs).where(inArray(chefs.id, chefIds));
    for (const r of rows) chefName.set(r.id, r.name);
  }
  if (clientIds.length) {
    const rows = await db
      .select({ id: clients.id, name: clients.companyName })
      .from(clients)
      .where(inArray(clients.id, clientIds));
    for (const r of rows) clientName.set(r.id, r.name);
  }
  if (shiftIds.length) {
    const rows = await db
      .select({ id: shifts.id, clientId: shifts.clientId })
      .from(shifts)
      .where(inArray(shifts.id, shiftIds));
    const wantClientIds = uniq(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)));
    const cn = new Map<string, string>();
    if (wantClientIds.length) {
      const crows = await db
        .select({ id: clients.id, name: clients.companyName })
        .from(clients)
        .where(inArray(clients.id, wantClientIds));
      for (const r of crows) cn.set(r.id, r.name);
    }
    for (const r of rows) shiftClient.set(r.id, r.clientId ? (cn.get(r.clientId) ?? null) : null);
  }

  return { chefName, clientName, shiftClient };
}

function labelFor(
  h: RetrievedChunk,
  names: { chefName: Map<string, string>; clientName: Map<string, string>; shiftClient: Map<string, string | null> },
): string {
  if (h.sourceTable === "chefs") {
    const n = names.chefName.get(h.sourcePk) ?? "een chef";
    return h.field === "profile" ? `Profiel van chef ${n}` : `Notitie over chef ${n}`;
  }
  if (h.sourceTable === "clients") {
    return `Notitie over klant ${names.clientName.get(h.sourcePk) ?? "onbekend"}`;
  }
  if (h.sourceTable === "shifts") {
    const c = names.shiftClient.get(h.sourcePk);
    return c ? `Dienst bij ${c}` : "Dienst";
  }
  if (h.sourceTable === "contact_logs") return "Contactnotitie";
  if (h.sourceTable === "docs") return `Documentatie: ${h.sourcePk}`;
  if (h.sourceTable === "chef_documents") return "CV-fragment";
  if (h.sourceTable === "placements") return "Afgeronde plaatsing";
  return h.sourceTable;
}

/** Below this cosine similarity the "best" chunk is noise — try keywords as well, so a
 *  half-built corpus can't shadow an exact-term hit that is sitting right there. */
const WEAK_MATCH = 0.35;

export async function searchKnowledgeForOwner(
  query: string,
  limit: number,
  scope: KeywordScope,
): Promise<KnowledgeSearchResult> {
  const chunks = await retrieveKnowledge({ query, actor: { kind: "internal" }, limit });
  const weak = chunks !== null && (chunks.length === 0 || (chunks[0]?.similarity ?? 0) < WEAK_MATCH);

  // No corpus (embeddings off / not yet ingested / OpenAI quota out) OR nothing better
  // than noise: fall back to a redacted keyword pass over the sources this caller may
  // see. Answering "kennisbank niet beschikbaar" while 260 filled notities sit in
  // Postgres is the worst of both worlds — the data exists, only the index does not.
  if (chunks === null || weak) {
    const kw = await searchKnowledgeByKeyword(query, limit, scope);
    if (kw.length > 0) {
      return { available: true, count: kw.length, via: "trefwoord", hits: kw.map((h) => ({ ...h, similarityPct: null })) };
    }
    // Nothing on either path. Report the KEYWORD path when it actually ran, so the
    // playbook's "probeer een synoniem"-hint fires on the branch that needs it most.
    if (chunks === null) return { available: false };
    if (chunks.length === 0) return { available: true, count: 0, hits: [], via: "trefwoord" };
  }
  if (chunks === null) return { available: false };

  const names = await resolveNames(chunks);
  const hits: KnowledgeHit[] = chunks.map((h) => ({
    sourceLabel: labelFor(h, names),
    source: `${h.sourceTable}:${h.sourcePk}`,
    field: h.field,
    snippet: h.text,
    similarityPct: Math.round(h.similarity * 100),
  }));
  return { available: true, count: hits.length, hits, via: "semantisch" };
}
