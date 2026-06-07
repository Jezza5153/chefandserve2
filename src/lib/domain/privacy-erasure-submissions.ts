/**
 * AVG erasure helper — redact the raw Jotform `rawPayload` jsonb of an intake
 * submission belonging to an erasure subject.
 *
 * The intake tables (chef_submissions / client_submissions / webhooks_received)
 * hold the subject's name/email/phone AND — for rows captured by the retired
 * "Personal data onboarding" Jotform — UNENCRYPTED BSN/IBAN/ID-document numbers
 * sitting in `rawPayload` (flagged "High risk" in docs/privacy/pii-inventory.md).
 *
 * Erasure anonymises in place (the established pattern for every other table):
 * the PII columns are nulled by the caller, and the raw blob is redacted here
 * rather than the row being deleted, so an audited anonymised shell survives.
 *
 * Redaction REUSES the single pure detector in rawpayload-pii.ts (the same
 * definition the read-only audit + guarded remediation script share):
 *   scanForPii(payload) → matchedPaths(matches) → redactPaths(payload, paths)
 *
 * Pure + self-contained (no DB, no env) — the caller does the UPDATE inside the
 * erasure transaction. Matched VALUES are never returned, only KEY NAMES (audit).
 */

import {
  matchedKeyNames,
  matchedPaths,
  redactPaths,
  scanForPii,
} from "./rawpayload-pii";

export type RawPayloadRedaction = {
  /** The cleaned payload (matched leaves nulled). Identical clone when nothing matched. */
  cleaned: unknown;
  /** Dotted KEY NAMES that were nulled — for the audit trail. NEVER values. */
  redactedKeys: string[];
  /** Distinct PII kinds found (bsn/iban/id). */
  kinds: string[];
  /** True when at least one special-category/financial/ID leaf was redacted. */
  changed: boolean;
};

/**
 * Scan a submission's rawPayload for embedded BSN/IBAN/ID-document PII and
 * return the redacted clone plus the audit metadata. Always returns a value
 * (when nothing matches, `cleaned` is the input and `changed` is false) so the
 * caller can write the column unconditionally inside the erasure tx.
 */
export function redactRawPayloadForSubject(
  payload: unknown,
): RawPayloadRedaction {
  const matches = scanForPii(payload);
  if (matches.length === 0) {
    return { cleaned: payload, redactedKeys: [], kinds: [], changed: false };
  }
  const paths = matchedPaths(matches);
  return {
    cleaned: redactPaths(payload, paths),
    redactedKeys: matchedKeyNames(matches), // key names only — never values
    kinds: [...new Set(matches.map((m) => m.kind))],
    changed: true,
  };
}
