/**
 * Directory read-model — the assistant's lookup over chefs + clients.
 *
 * Read-only, and it deliberately returns ONLY safe display fields. It NEVER selects the
 * encrypted PII columns (bsn/iban/id-number) or financial identifiers — those must not
 * reach the LLM. Soft-deleted (AVG-erased) rows are excluded.
 *
 * ⚠️ ARRAY COLUMNS. `segments`, `skill_tags`, `languages` and `owner_tags` are `text[]`.
 * Postgres has NO implicit cast from text[] to text, so `ilike(chefs.segments, …)` raises
 * `operator does not exist: text[] ~~* unknown` and takes the WHOLE query down with it.
 * That bug shipped: `chefs.find` failed on every non-empty query in production (audit_log:
 * 11 failures to 2 successes over 60 days) while the tool-routing eval stayed green,
 * because that eval never executes a tool. Always go through `arrayText()` below, and keep
 * scripts/smoke-chefs-find.ts green — it RUNS the query.
 */
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs, clients, shifts } from "@/lib/db/schema";
import { CHEF_AVERAGE_MIN_COUNT } from "@/lib/rating-tags";

const clampLimit = (n: number | undefined): number => Math.min(Math.max(n ?? 10, 1), 25);

/** A text[] column flattened for substring search. See the array warning above. */
const arrayText = (col: unknown): SQL => sql`array_to_string(coalesce(${col}, '{}'), ' ')`;

export type ChefHit = {
  id: string;
  fullName: string;
  vakniveau: string | null;
  segments: string[] | null;
  skillTags: string[] | null;
  languages: string[] | null;
  specialties: string | null;
  recentVenues: string | null;
  city: string | null;
  yearsExperience: number | null;
  hourlyRateMinCents: number | null;
  averageRating: string | null;
  ratingCount: number | null;
  status: string;
  // NB: contact details (email/phone) intentionally NOT exposed to the AI directory —
  // routing only needs id/name/city/segment. Use chefs.work_summary for the track record
  // and chefs.reachability for contact details. (AVG data-minimisation.)
};

export type FindChefsInput = {
  /** Free text over name, city, specialties, recent venues, and the tag arrays. */
  q?: string;
  city?: string;
  vakniveau?: string;
  segment?: string;
  /** Curated keys from src/lib/domain/skill-tags.ts — matches a chef holding ANY of them. */
  skillTags?: string[];
  /** Case-insensitive, matches any entry of the chef's languages array. */
  language?: string;
  /** The chef's own minimum must be at or under this to count as affordable. */
  maxRateCents?: number;
  minRating?: number;
  /** ISO date. Excludes chefs who explicitly blocked that day ("no row" = available). */
  availableOn?: string;
  /** Include archived/inactive chefs. Default false — they must not rank as live ones. */
  includeInactive?: boolean;
  limit?: number;
};

/**
 * `notes` carries any requested filter this query could NOT honour, so the assistant can
 * say "ik kon niet filteren op X" instead of returning a confidently wrong set. A silently
 * dropped constraint is worse than no answer — it looks like an answer.
 */
export type FindChefsResult = { chefs: ChefHit[]; notes: string[] };

export async function findChefs(opts: FindChefsInput): Promise<FindChefsResult> {
  const where: SQL[] = [isNull(chefs.deletedAt)];
  const notes: string[] = [];

  if (!opts.includeInactive) where.push(sql`${chefs.status} in ('active', 'onboarding')`);

  const q = opts.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const m = or(
      ilike(chefs.fullName, like),
      ilike(chefs.city, like),
      ilike(chefs.specialties, like),
      ilike(chefs.recentVenues, like),
      sql`${arrayText(chefs.segments)} ilike ${like}`,
      sql`${arrayText(chefs.skillTags)} ilike ${like}`,
      sql`${arrayText(chefs.languages)} ilike ${like}`,
      sql`${arrayText(chefs.ownerTags)} ilike ${like}`,
    );
    if (m) where.push(m);
  }

  if (opts.city?.trim()) where.push(ilike(chefs.city, `%${opts.city.trim()}%`));
  if (opts.vakniveau?.trim()) where.push(sql`${chefs.vakniveau} = ${opts.vakniveau.trim()}`);
  if (opts.segment?.trim()) where.push(sql`${opts.segment.trim()} = ANY(${chefs.segments})`);

  const tags = opts.skillTags?.filter(Boolean) ?? [];
  if (tags.length) {
    // Bind each element separately. Passing the JS array straight in makes drizzle emit a
    // record — "malformed array literal" for one tag, "cannot cast type record to text[]"
    // for several.
    const arr = sql`array[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]`;
    where.push(sql`${chefs.skillTags} && ${arr}`);
  }

  if (opts.language?.trim()) {
    // The array is unnormalised ("NL" / "nl" / "Nederlands" all occur), so: substring,
    // case-insensitive, over each element.
    const lang = `%${opts.language.trim()}%`;
    where.push(
      sql`exists (select 1 from unnest(coalesce(${chefs.languages}, '{}')) l where l ilike ${lang})`,
    );
  }

  if (typeof opts.maxRateCents === "number") {
    // A chef with no rate on file is NOT silently affordable — exclude and say so.
    where.push(
      sql`${chefs.hourlyRateMinCents} is not null and ${chefs.hourlyRateMinCents} <= ${opts.maxRateCents}`,
    );
    notes.push("Chefs zonder tarief in het profiel vallen buiten dit filter.");
  }

  if (typeof opts.minRating === "number" && opts.minRating > 0) {
    where.push(sql`${chefs.averageRating} >= ${opts.minRating}`);
  }

  if (opts.availableOn) {
    const day = opts.availableOn.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      // "No row = available", so this can only exclude an EXPLICIT block — it can never
      // confirm someone is genuinely free. Say that out loud rather than implying certainty.
      where.push(sql`not exists (
        select 1 from ${chefAvailability}
        where ${chefAvailability.chefId} = ${chefs.id}
          and ${chefAvailability.date} = ${day}::date
          and ${chefAvailability.available} = false
      )`);
      notes.push(
        "Beschikbaarheid sluit alleen chefs uit die die dag zélf geblokkeerd hebben — geen blokkade betekent 'niet bekend', niet 'zeker vrij'.",
      );
    } else {
      notes.push(`Kon niet filteren op beschikbaarheid: "${opts.availableOn}" is geen geldige datum.`);
    }
  }

  const rows = await db
    .select({
      id: chefs.id,
      fullName: chefs.fullName,
      vakniveau: chefs.vakniveau,
      segments: chefs.segments,
      skillTags: chefs.skillTags,
      languages: chefs.languages,
      specialties: chefs.specialties,
      recentVenues: chefs.recentVenues,
      city: chefs.city,
      yearsExperience: chefs.yearsExperience,
      hourlyRateMinCents: chefs.hourlyRateMinCents,
      averageRating: chefs.averageRating,
      ratingCount: chefs.ratingCount,
      status: chefs.status,
    })
    .from(chefs)
    .where(and(...where))
    .orderBy(
      // Volume before average: a single 5.0 must not outrank a 4.8 earned over 40 shifts.
      sql`case when ${chefs.ratingCount} >= ${CHEF_AVERAGE_MIN_COUNT} then 0 else 1 end`,
      sql`${chefs.averageRating} desc nulls last`,
      desc(chefs.ratingCount),
      chefs.fullName, // deterministic tail — the same query returns the same order
    )
    .limit(clampLimit(opts.limit));

  return { chefs: rows as ChefHit[], notes };
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
