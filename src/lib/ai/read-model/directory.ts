/**
 * Directory read-model — the assistant's lookup over chefs + clients.
 *
 * Read-only, and it deliberately returns ONLY safe display fields. It NEVER selects the
 * encrypted PII columns (bsn/iban/id-number) or financial identifiers — those must not
 * reach the LLM. Soft-deleted (AVG-erased) rows are excluded.
 */
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, shifts } from "@/lib/db/schema";

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
  // NB: contact details (email/phone) intentionally NOT exposed to the AI
  // directory — routing only needs id/name/city/segment. Use chefs.work_summary
  // for deeper detail. (AVG data-minimisation.)
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
  // Contact details intentionally NOT exposed to the AI directory (AVG); use
  // clients.health / clients.reachability for deeper detail.
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
    })
    .from(clients)
    .where(where)
    .orderBy(clients.companyName)
    .limit(clampLimit(opts.limit));

  return rows as ClientHit[];
}

export type ShiftStatus = "request" | "open" | "filled" | "completed" | "cancelled";

export type ShiftHit = {
  id: string;
  client: string | null;
  roleNeeded: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  city: string | null;
  headcount: number;
  status: string;
};

export async function findShifts(opts: {
  q?: string;
  status?: ShiftStatus;
  limit?: number;
}): Promise<ShiftHit[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q}%` : null;
  const conds: SQL[] = [];
  if (opts.status) conds.push(eq(shifts.status, opts.status));
  if (like) {
    const m = or(
      ilike(clients.companyName, like),
      ilike(shifts.roleNeeded, like),
      ilike(shifts.location, like),
      ilike(shifts.city, like),
    );
    if (m) conds.push(m);
  }

  const rows = await db
    .select({
      id: shifts.id,
      client: clients.companyName,
      roleNeeded: shifts.roleNeeded,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      location: shifts.location,
      city: shifts.city,
      headcount: shifts.headcount,
      status: shifts.status,
    })
    .from(shifts)
    .leftJoin(clients, eq(shifts.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(shifts.startsAt))
    .limit(clampLimit(opts.limit));

  return rows as ShiftHit[];
}
