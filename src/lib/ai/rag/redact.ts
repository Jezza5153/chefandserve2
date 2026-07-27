/**
 * PII redaction for RAG ingestion — AVG/load-bearing. Runs at INDEX time so embeddings
 * never carry PII (docs/ai/rag-ingestion-contract.md §Redaction). Every pattern is unit-
 * tested in scripts/smoke-ai-rag.mts (a pre-flight requirement). Bump REDACTION_VERSION
 * when a pattern is tightened → forces a full reindex.
 *
 * Order matters: the most specific patterns (IBAN, 16-digit card) run before the looser
 * digit-run patterns (BSN = any 9 digits) so a card/IBAN isn't mis-split.
 */
export const REDACTION_VERSION = 2;

const PATTERNS: Array<{ re: RegExp; tag: string }> = [
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, tag: "<email>" },
  // IBAN: any SEPA country, spaced or not. Was NL-only, but the migrated CRM text holds
  // BE/DE/ES accounts of chefs who bank abroad.
  { re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, tag: "<iban>" },
  // BTW/VAT: NL001234567B01 and the EU shapes around it.
  { re: /\b[A-Z]{2}\d{9}B\d{2}\b/gi, tag: "<btw>" },
  // Phone: now also the standard Dutch business notation with a bracketed trunk zero
  // ("+31 (0)6-19735430") — the single most common form in the migrated notes.
  { re: /(?<![\d+])(?:\+31|0031)\s?\(0\)\s?\d(?:[\s-]?\d){7,8}(?!\d)/g, tag: "<phone>" },
  { re: /(?<![\d+])(?:\+31|0031|06|0[1-9])[\s-]?\d(?:[\s-]?\d){7,8}(?!\d)/g, tag: "<phone>" },
  { re: /\b\d{16}\b/g, tag: "<card>" },
  { re: /\b\d{9}\b/g, tag: "<bsn>" },
  { re: /\b(?:0[1-9]|[12]\d|3[01])-(?:0[1-9]|1[0-2])-(?:19\d{2}|200\d|2010)\b/g, tag: "<dob>" },
  // Dutch street address with a house number, and bare postcodes. Home addresses of
  // chefs appear in old intake notes; the assistant never needs them (the shift address
  // comes from the klant record).
  { re: /\b\d{4}\s?[A-Z]{2}\b(?=\s|,|$)/g, tag: "<postcode>" },
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
