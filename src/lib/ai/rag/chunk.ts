/**
 * Chunking for RAG ingestion (docs/ai/rag-ingestion-contract.md §Chunking). ~500-token
 * (~2000-char) target, ~50-token (~200-char) overlap, never split mid-paragraph where it
 * can be helped; a single oversized paragraph is sentence-split at the hard cap. Char≈token/4
 * heuristic (no tokenizer dependency). Pure + tested.
 */
const TARGET_CHARS = 2000; // ~500 tokens
const OVERLAP_CHARS = 200; // ~50 tokens
const HARD_CAP_CHARS = 4000; // ~1000 tokens

export function chunkText(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  if (text.length <= TARGET_CHARS) return [text];

  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";

  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
  };

  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > TARGET_CHARS) {
      flush();
      // carry an overlap tail from the previous chunk for continuity
      cur = `${cur.slice(-OVERLAP_CHARS)}\n\n${p}`;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    // a single huge paragraph: sentence-split it down under the hard cap
    while (cur.length > HARD_CAP_CHARS) {
      const dot = cur.lastIndexOf(". ", HARD_CAP_CHARS);
      const at = dot > TARGET_CHARS ? dot + 1 : HARD_CAP_CHARS;
      chunks.push(cur.slice(0, at).trim());
      cur = cur.slice(Math.max(0, at - OVERLAP_CHARS));
    }
  }
  flush();
  return chunks;
}
