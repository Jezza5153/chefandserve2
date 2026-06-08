/**
 * PII redaction for RAG ingestion — AVG/load-bearing. Runs at INDEX time so embeddings
 * never carry PII (docs/ai/rag-ingestion-contract.md §Redaction). Every pattern is unit-
 * tested in scripts/smoke-ai-rag.mts (a pre-flight requirement). Bump REDACTION_VERSION
 * when a pattern is tightened → forces a full reindex.
 *
 * Order matters: the most specific patterns (IBAN, 16-digit card) run before the looser
 * digit-run patterns (BSN = any 9 digits) so a card/IBAN isn't mis-split.
 */
export const REDACTION_VERSION = 1;

const PATTERNS: Array<{ re: RegExp; tag: string }> = [
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, tag: "<email>" },
  { re: /\bNL\d{2}[A-Z]{4}\d{10}\b/gi, tag: "<iban>" },
  { re: /(?<![\d+])(?:\+31|0031|06|0[1-9])[\s-]?\d(?:[\s-]?\d){7,8}(?!\d)/g, tag: "<phone>" },
  { re: /\b\d{16}\b/g, tag: "<card>" },
  { re: /\b\d{9}\b/g, tag: "<bsn>" },
  { re: /\b(?:0[1-9]|[12]\d|3[01])-(?:0[1-9]|1[0-2])-(?:19\d{2}|200\d|2010)\b/g, tag: "<dob>" },
];

export type RedactionResult = { text: string; redactedCount: number };

/** Replace PII matches with typed placeholders; reports how many replacements happened. */
export function redact(input: string): RedactionResult {
  let text = input;
  let redactedCount = 0;
  for (const { re, tag } of PATTERNS) {
    text = text.replace(re, () => {
      redactedCount++;
      return tag;
    });
  }
  return { text, redactedCount };
}

/**
 * True when >30% of whitespace-tokens were redacted — the chunk is too PII-dense to be
 * intelligible, so the indexer SKIPS it (emits `ai.index_skipped_pii_dense`).
 */
export function isPiiDense(original: string, result: RedactionResult): boolean {
  const tokens = original.trim().split(/\s+/).filter(Boolean).length;
  if (tokens === 0) return false;
  return result.redactedCount / tokens > 0.3;
}
