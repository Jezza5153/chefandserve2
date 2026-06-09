/**
 * Client onboarding-completeness read-model — "welke klanten missen nog bedrijfsgegevens,
 * een contactpersoon of RI&E om goed mee te kunnen werken?". The B2B sibling of
 * read-model/onboarding.ts (chefs). Wraps the tested getClientOnboardingReadiness, which takes
 * only PRESENCE booleans + plain fields and returns the MISSING FIELD LABELS — never the contact
 * PII (names/emails/phones). So the assistant can chase klant-completeness without ever exposing
 * personal data (AVG-safe by design). Billing fields are never part of this (invoicing team owns them).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clientContacts, clientDocuments, clients } from "@/lib/db/schema";
import { getClientOnboardingReadiness } from "@/lib/domain/profile-completeness";

const CLIENT_COLS = {
  id: clients.id,
  companyName: clients.companyName,
  visitStreet: clients.visitStreet,
  visitHouseNumber: clients.visitHouseNumber,
  visitPostcode: clients.visitPostcode,
  visitCity: clients.visitCity,
  kvk: clients.kvk,
  btw: clients.btw,
  rechtsvorm: clients.rechtsvorm,
  rieAvailable: clients.rieAvailable,
  safetyInstructions: clients.safetyInstructions,
  onboardingStatus: clients.onboardingStatus,
};

type ClientRow = { [K in keyof typeof CLIENT_COLS]: unknown } & { id: string; companyName: string };

function readinessFor(c: ClientRow, roles: Set<string>, docTypes: Set<string>) {
  return getClientOnboardingReadiness({
    companyName: c.companyName as string | null,
    visitStreet: c.visitStreet as string | null,
    visitHouseNumber: c.visitHouseNumber as string | null,
    visitPostcode: c.visitPostcode as string | null,
    visitCity: c.visitCity as string | null,
    kvk: c.kvk as string | null,
    btw: c.btw as string | null,
    rechtsvorm: c.rechtsvorm as string | null,
    hasGeneralContact: roles.has("general_contact"),
    hasSigningContact: roles.has("signing_authority"),
    rieAvailable: c.rieAvailable as boolean | null,
    hasRieDocument: docTypes.has("rie_document"),
    safetyInstructions: c.safetyInstructions as string | null,
    onboardingStatus: c.onboardingStatus as string | null,
  });
}

export type ClientOnboardingStatus = {
  clientId: string;
  client: string;
  missing: string[];
  score: number;
  ready: boolean;
  submitted: boolean;
};

/** Roles + doc types per client, for the readiness fan-in. */
async function contextFor(ids: string[]): Promise<{
  roles: Map<string, Set<string>>;
  docs: Map<string, Set<string>>;
}> {
  const [contactRows, docRows] = await Promise.all([
    db
      .select({ clientId: clientContacts.clientId, role: clientContacts.role })
      .from(clientContacts)
      .where(inArray(clientContacts.clientId, ids)),
    db
      .select({ clientId: clientDocuments.clientId, type: clientDocuments.type })
      .from(clientDocuments)
      .where(and(isNull(clientDocuments.deletedAt), inArray(clientDocuments.clientId, ids))),
  ]);
  const roles = new Map<string, Set<string>>();
  for (const r of contactRows) {
    let set = roles.get(r.clientId);
    if (!set) roles.set(r.clientId, (set = new Set()));
    set.add(r.role);
  }
  const docs = new Map<string, Set<string>>();
  for (const d of docRows) {
    let set = docs.get(d.clientId);
    if (!set) docs.set(d.clientId, (set = new Set()));
    set.add(d.type);
  }
  return { roles, docs };
}

/** All prospect/active clients that are not yet onboarding-complete, least-complete first. Labels only. */
export async function sweepClientOnboarding(): Promise<ClientOnboardingStatus[]> {
  const rows = (await db
    .select(CLIENT_COLS)
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["prospect", "active"])))) as ClientRow[];
  if (rows.length === 0) return [];

  const { roles, docs } = await contextFor(rows.map((r) => r.id));

  return rows
    .map((c) => {
      const r = readinessFor(c, roles.get(c.id) ?? new Set(), docs.get(c.id) ?? new Set());
      return {
        clientId: c.id,
        client: c.companyName,
        missing: r.missingCritical,
        score: r.score,
        ready: r.ready,
        submitted: r.submitted,
      };
    })
    .filter((x) => !x.ready)
    .sort((a, b) => a.score - b.score);
}

/** One client's onboarding status (missing field labels only). */
export async function clientOnboardingStatus(clientId: string): Promise<ClientOnboardingStatus | null> {
  const [c] = (await db.select(CLIENT_COLS).from(clients).where(eq(clients.id, clientId)).limit(1)) as ClientRow[];
  if (!c) return null;
  const { roles, docs } = await contextFor([clientId]);
  const r = readinessFor(c, roles.get(clientId) ?? new Set(), docs.get(clientId) ?? new Set());
  return {
    clientId,
    client: c.companyName,
    missing: r.missingCritical,
    score: r.score,
    ready: r.ready,
    submitted: r.submitted,
  };
}
