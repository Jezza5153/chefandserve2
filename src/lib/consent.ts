/**
 * Consent module — PR-CHEF-10.
 *
 * Current document versions per kind. Bump these to force re-consent
 * (the modal re-renders for users without a matching row).
 *
 * V1 = placeholder copy. The lawyer fills in /privacy-chef + /privacy-klant
 * MDX with the real text before AVG_CONSENT_ENFORCED is flipped on.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { consentLog } from "@/lib/db/schema";

export const CURRENT_VERSIONS = {
  chef: "gegevensgebruik_chef_v1",
  client: "gegevensgebruik_klant_v1",
  // PR-FB: consent for processing special-category onboarding PII (BSN/IBAN/ID).
  // Recorded at Stage-2 onboarding submit; not gated by the ConsentGate.
  chef_onboarding: "verwerking_bijzondere_gegevens_chef_v1",
  // PR-CLIENT-ONBOARDING: consent for the company-data onboarding submit (BEDRIJFSGEGEVENS).
  client_onboarding: "verwerking_bedrijfsgegevens_klant_v1",
} as const;

export type ConsentKind = keyof typeof CURRENT_VERSIONS;

export function currentDocumentKey(kind: ConsentKind): string {
  return CURRENT_VERSIONS[kind];
}

/**
 * Has the user accepted the current version for their kind?
 */
export async function hasCurrentConsent(args: {
  userId: string;
  kind: ConsentKind;
}): Promise<boolean> {
  const key = currentDocumentKey(args.kind);
  const [row] = await db
    .select({ id: consentLog.id })
    .from(consentLog)
    .where(
      and(
        eq(consentLog.userId, args.userId),
        eq(consentLog.documentKey, key),
      ),
    )
    .orderBy(desc(consentLog.acceptedAt))
    .limit(1);
  return Boolean(row);
}

/**
 * Append a consent row. Never updates — every accept is a new row, so
 * we have a complete history of who agreed to what version when.
 */
export async function recordConsent(args: {
  userId: string;
  kind: ConsentKind;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await db.insert(consentLog).values({
    userId: args.userId,
    documentKey: currentDocumentKey(args.kind),
    ip: args.ip,
    userAgent: args.userAgent,
  });
}

/**
 * Feature flag — when true, middleware/server actions BLOCK users without
 * consent. Default false in V1 so we can ship the modal as a soft hint
 * before the lawyer finalizes the legal text.
 */
export function isConsentEnforced(): boolean {
  return process.env.AVG_CONSENT_ENFORCED === "true";
}
