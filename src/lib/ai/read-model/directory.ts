/**
 * Directory read-model — the assistant's lookup over chefs + clients.
 *
 * Read-only, and it deliberately returns ONLY safe display fields. It NEVER selects the
 * encrypted PII columns (bsn/iban/id-number) or financial identifiers — those must not
 * reach the LLM. Soft-deleted (AVG-erased) rows are excluded.
 */
import { and, desc, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients } from "@/lib/db/schema";

const clampLimit = (n: number | undefined): number => Math.min(Math.max(n ?? 10, 1), 25);

export type ChefHit = {
  id: string;
  fullName: string;
  vakniveau: string | null;
  segments: string | null;
  specialties: string | null;
  city: string | null;
  yearsExperience: number | null;
  averageRating: string | null;
  ratingCount: number | null;
  status: string;
  email: string | null;
  phone: string | null;
};

export async function findChefs(opts: { q?: string; limit?: number }): Promise<ChefHit[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q}%` : null;
  const where: SQL | undefined = like
    ? and(
        isNull(chefs.deletedAt),
        or(
          ilike(chefs.fullName, like),
          ilike(chefs.city, like),
          ilike(chefs.specialties, like),
          ilike(chefs.segments, like),
        ),
      )
    : isNull(chefs.deletedAt);

  const rows = await db
    .select({
      id: chefs.id,
      fullName: chefs.fullName,
      vakniveau: chefs.vakniveau,
      segments: chefs.segments,
      specialties: chefs.specialties,
      city: chefs.city,
      yearsExperience: chefs.yearsExperience,
      averageRating: chefs.averageRating,
      ratingCount: chefs.ratingCount,
      status: chefs.status,
      email: chefs.email,
      phone: chefs.phone,
    })
    .from(chefs)
    .where(where)
    .orderBy(sql`${chefs.averageRating} desc nulls last`, chefs.fullName)
    .limit(clampLimit(opts.limit));

  return rows as ChefHit[];
}

export type ClientHit = {
  id: string;
  companyName: string;
  contactName: string | null;
  city: string | null;
  segment: string | null;
  clientType: string | null;
  status: string;
  email: string | null;
  phone: string | null;
};

export async function findClients(opts: { q?: string; limit?: number }): Promise<ClientHit[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q}%` : null;
  const where: SQL | undefined = like
    ? and(
        isNull(clients.deletedAt),
        or(
          ilike(clients.companyName, like),
          ilike(clients.contactName, like),
          ilike(clients.city, like),
        ),
      )
    : isNull(clients.deletedAt);

  const rows = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      city: clients.city,
      segment: clients.segment,
      clientType: clients.clientType,
      status: clients.status,
      email: clients.email,
      phone: clients.phone,
    })
    .from(clients)
    .where(where)
    .orderBy(clients.companyName)
    .limit(clampLimit(opts.limit));

  return rows as ClientHit[];
}
