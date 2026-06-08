/**
 * App-side embeddings — embed a query for semantic (vector) search. Mirrors the
 * embedding-refresh worker's call (text-embedding-3-small, dim 1536) so the query and the
 * corpus vectors live in the SAME space. Returns null when no key is set, so callers
 * degrade gracefully instead of throwing.
 */
import { env } from "@/lib/env";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

export function aiEmbeddingsEnabled(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = data.data?.[0]?.embedding;
    return vec && vec.length === EMBEDDING_DIM ? vec : null;
  } catch {
    return null;
  }
}

/** pgvector input literal: `[0.1,0.2,…]`. */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
