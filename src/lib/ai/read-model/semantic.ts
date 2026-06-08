/**
 * Semantic (vector) search over the per-row embeddings the embedding-refresh worker
 * maintains (chefs.embedding · text-embedding-3-small · pgvector cosine). Complements the
 * keyword chefs.find — "vind een chef zóals X / met deze eigenschap".
 *
 * Raw SQL because the vector columns live outside the Drizzle schema. Returns null (degrade
 * to "not available") when the key is absent OR the vector column/extension isn't there yet;
 * returns [] when search works but nothing matches (e.g. embeddings not generated yet).
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { embedText, vectorLiteral } from "@/lib/ai/embeddings";
import { formatChefRole } from "@/lib/labels";

export type SemanticChefMatch = {
  chefId: string;
  name: string;
  vakniveau: string;
  city: string | null;
  similarity: number; // 0..1 (1 = identical direction)
};

export async function semanticSearchChefs(
  query: string,
  limit: number,
): Promise<SemanticChefMatch[] | null> {
  const vec = await embedText(query);
  if (!vec) return null; // no key / embed failed
  const lit = vectorLiteral(vec);

  let res: unknown;
  try {
    res = await db.execute(sql`
      SELECT id, full_name, vakniveau, city,
             round((1 - (embedding <=> ${lit}::vector))::numeric, 3) AS similarity
      FROM chefs
      WHERE embedding IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${limit}
    `);
  } catch {
    return null; // vector column / pgvector extension not present yet
  }

  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    full_name: string;
    vakniveau: string | null;
    city: string | null;
    similarity: number | string;
  }>;
  return rows.map((r) => ({
    chefId: r.id,
    name: r.full_name,
    vakniveau: formatChefRole(r.vakniveau),
    city: r.city,
    similarity: Number(r.similarity),
  }));
}

export type SemanticClientMatch = {
  clientId: string;
  name: string;
  city: string | null;
  similarity: number;
};

export async function semanticSearchClients(
  query: string,
  limit: number,
): Promise<SemanticClientMatch[] | null> {
  const vec = await embedText(query);
  if (!vec) return null;
  const lit = vectorLiteral(vec);

  let res: unknown;
  try {
    res = await db.execute(sql`
      SELECT id, company_name, city,
             round((1 - (embedding <=> ${lit}::vector))::numeric, 3) AS similarity
      FROM clients
      WHERE embedding IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${limit}
    `);
  } catch {
    return null;
  }

  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    company_name: string;
    city: string | null;
    similarity: number | string;
  }>;
  return rows.map((r) => ({
    clientId: r.id,
    name: r.company_name,
    city: r.city,
    similarity: Number(r.similarity),
  }));
}
