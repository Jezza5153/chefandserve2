/**
 * Onboarding-completeness read-model — "wie mist nog verplichte AVG/onboarding-gegevens om
 * ingezet + uitbetaald te worden?". Wraps the tested getOnboardingReadiness, which takes only
 * BOOLEANS (filled?) and returns the MISSING FIELD LABELS — never the sensitive values. So the
 * assistant can chase completeness without ever touching BSN/IBAN/ID data (AVG-safe by design).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { getOnboardingReadiness } from "@/lib/domain/profile-completeness";

/** Exported so the deployability gate (P3a) reuses the EXACT readiness inputs. */
export const CHEF_COLS = {
  id: chefs.id,
  fullName: chefs.fullName,
  firstName: chefs.firstName,
  surname: chefs.surname,
  dateOfBirth: chefs.dateOfBirth,
  bsnEncrypted: chefs.bsnEncrypted,
  ibanEncrypted: chefs.ibanEncrypted,
  bankAccountHolderName: chefs.bankAccountHolderName,
  idType: chefs.idType,
  idNumberEncrypted: chefs.idNumberEncrypted,
  idExpiresAt: chefs.idExpiresAt,
  street: chefs.street,
  houseNumber: chefs.houseNumber,
  postcode: chefs.postcode,
  applyingAs: chefs.applyingAs,
  employmentType: chefs.employmentType,
};

export type ChefRow = { [K in keyof typeof CHEF_COLS]: unknown } & { id: string; fullName: string };

/** Exported so the deployability gate (P3a) maps a chef row → readiness identically. */
export function readinessFor(c: ChefRow, docTypes: Set<string>) {
  return getOnboardingReadiness({
    firstName: c.firstName as string | null,
    surname: c.surname as string | null,
    dateOfBirth: c.dateOfBirth,
    bsnFilled: !!c.bsnEncrypted,
    ibanFilled: !!c.ibanEncrypted,
    bankAccountHolderName: c.bankAccountHolderName as string | null,
    idType: c.idType as string | null,
    idNumberFilled: !!c.idNumberEncrypted,
    idExpiresAt: c.idExpiresAt as Date | string | null,
    street: c.street as string | null,
    houseNumber: c.houseNumber as string | null,
    postcode: c.postcode as string | null,
    applyingAs: c.applyingAs as string | null,
    employmentType: c.employmentType as string | null,
    hasIdFront: docTypes.has("id_copy_front"),
    hasIdBack: docTypes.has("id_copy_back"),
  });
}

export type ChefOnboardingStatus = {
  chefId: string;
  chef: string;
  missing: string[];
  score: number;
  ready: boolean;
  idExpired: boolean;
  idExpiringSoon: boolean;
};

/** All ACTIVE chefs that are not yet onboarding-complete, least-complete first. Labels only. */
export async function sweepChefOnboarding(): Promise<ChefOnboardingStatus[]> {
  const rows = (await db
    .select(CHEF_COLS)
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active")))) as ChefRow[];
  if (rows.length === 0) return [];

  const docs = await db
    .select({ chefId: chefDocuments.chefId, type: chefDocuments.type })
    .from(chefDocuments)
    .where(and(isNull(chefDocuments.deletedAt), inArray(chefDocuments.chefId, rows.map((r) => r.id))));
  const byChef = new Map<string, Set<string>>();
  for (const d of docs) {
    let set = byChef.get(d.chefId);
    if (!set) byChef.set(d.chefId, (set = new Set()));
    set.add(d.type);
  }

  return rows
    .map((c) => {
      const r = readinessFor(c, byChef.get(c.id) ?? new Set());
      return { chefId: c.id, chef: c.fullName, missing: r.missingCritical, score: r.score, ready: r.ready, idExpired: r.idExpired, idExpiringSoon: r.idExpiringSoon };
    })
    .filter((x) => !x.ready)
    .sort((a, b) => a.score - b.score);
}

/** One chef's onboarding status (missing field labels only). */
export async function chefOnboardingStatus(chefId: string): Promise<ChefOnboardingStatus | null> {
  const [c] = (await db.select(CHEF_COLS).from(chefs).where(eq(chefs.id, chefId)).limit(1)) as ChefRow[];
  if (!c) return null;
  const docs = await db
    .select({ type: chefDocuments.type })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.chefId, chefId), isNull(chefDocuments.deletedAt)));
  const r = readinessFor(c, new Set(docs.map((d) => d.type)));
  return { chefId, chef: c.fullName, missing: r.missingCritical, score: r.score, ready: r.ready, idExpired: r.idExpired, idExpiringSoon: r.idExpiringSoon };
}
