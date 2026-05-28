/**
 * PR-AVG-2: data-subject resolution + structured legal holds + tombstone hashing.
 *
 * Shared foundation for export (privacy-export.ts) and erasure (privacy-erasure.ts).
 *
 * A privacy_request points at a person who may be:
 *   - a portal user (request.userId) linked to a chefs/clients row, OR
 *   - an off-portal person (request.requesterEmail) with no account.
 * `resolveSubject` fans out from BOTH the userId AND the email so a DSAR gathers
 * everything regardless of how the person reached us (pii-inventory.md "Identity
 * of the subject note").
 *
 * `getLegalHoldsForUser` is THE single source of truth for what we must keep
 * under the fiscale bewaarplicht (~7y). It feeds: preview, export
 * retained-data-explanation, erasure result, admin detail, AI docs (plan rule #6).
 */

import { createHmac } from "node:crypto";

import { eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  payrollBatchLines,
  privacyErasureTombstones,
  shiftHourCorrections,
  shiftHours,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";

/* ----- data subject -------------------------------------------------------- */

export type SubjectKind = "chef" | "klant" | "unknown";

export type DataSubject = {
  userId: string | null;
  chefId: string | null;
  clientId: string | null;
  email: string | null;
  displayName: string | null;
  kind: SubjectKind;
};

/**
 * Resolve the person behind a privacy request into the master records we hold.
 * Matches by linked account (userId) first, then by email (off-portal / pre-portal).
 */
export async function resolveSubject(req: {
  userId: string | null;
  requesterEmail: string | null;
  requesterName?: string | null;
}): Promise<DataSubject> {
  let email = req.requesterEmail?.trim().toLowerCase() ?? null;
  let displayName = req.requesterName ?? null;

  if (req.userId) {
    const [u] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, req.userId))
      .limit(1);
    if (u?.email) email = u.email.toLowerCase();
    if (u?.name) displayName = displayName ?? u.name;
  }

  // Chef: linked account OR matching email.
  const chefConds: SQL[] = [];
  if (req.userId) chefConds.push(eq(chefs.userId, req.userId));
  if (email) chefConds.push(eq(sql`lower(${chefs.email})`, email));
  const [chef] = chefConds.length
    ? await db
        .select({ id: chefs.id, fullName: chefs.fullName })
        .from(chefs)
        .where(or(...chefConds))
        .limit(1)
    : [];

  // Client: linked account OR matching contact email.
  const clientConds: SQL[] = [];
  if (req.userId) clientConds.push(eq(clients.userId, req.userId));
  if (email) clientConds.push(eq(sql`lower(${clients.email})`, email));
  const [client] = clientConds.length
    ? await db
        .select({
          id: clients.id,
          companyName: clients.companyName,
          contactName: clients.contactName,
        })
        .from(clients)
        .where(or(...clientConds))
        .limit(1)
    : [];

  const kind: SubjectKind = chef ? "chef" : client ? "klant" : "unknown";
  return {
    userId: req.userId,
    chefId: chef?.id ?? null,
    clientId: client?.id ?? null,
    email,
    displayName:
      displayName ?? chef?.fullName ?? client?.contactName ?? client?.companyName ?? null,
    kind,
  };
}

/* ----- legal holds --------------------------------------------------------- */

/** Aggregated hold (per entity type) — what we keep and until when. */
export type LegalHold = {
  entityType: string;
  count: number;
  reason: string;
  legalBasis: string;
  /** Latest retain-until across the held rows (null if unknown). */
  retainUntil: Date | null;
};

const FISCAL_HOLD_YEARS = 7;
const FISCAL_BASIS =
  "Fiscale bewaarplicht (art. 52 Algemene wet inzake rijksbelastingen) — 7 jaar";

function plusYears(d: Date, years: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + years);
  return x;
}

/**
 * Compute the fiscale-bewaarplicht holds for a subject. Anything tied to the
 * payroll/hours/invoicing administration is RETAINED (refused for erasure) until
 * its 7-year window expires. Returned aggregated by entity type — a chef with
 * 200 shifts yields ONE shift_hours hold (count=200), not 200 list items.
 */
export async function getLegalHoldsForUser(subject: {
  chefId: string | null;
  clientId: string | null;
}): Promise<LegalHold[]> {
  const holds: LegalHold[] = [];
  if (!subject.chefId && !subject.clientId) return holds;

  const hoursConds: SQL[] = [];
  if (subject.chefId) hoursConds.push(eq(shiftHours.chefId, subject.chefId));
  if (subject.clientId) hoursConds.push(eq(shiftHours.clientId, subject.clientId));

  // shift_hours — the payroll evidence backbone.
  const hours = await db
    .select({ id: shiftHours.id, createdAt: shiftHours.createdAt })
    .from(shiftHours)
    .where(or(...hoursConds));
  if (hours.length === 0) return holds;

  const latest = hours.reduce<Date | null>((acc, r) => {
    const until = plusYears(r.createdAt, FISCAL_HOLD_YEARS);
    return !acc || until > acc ? until : acc;
  }, null);
  holds.push({
    entityType: "shift_hours",
    count: hours.length,
    reason: "Gewerkte uren zijn loon-/factuuradministratie en mogen niet worden gewist.",
    legalBasis: FISCAL_BASIS,
    retainUntil: latest,
  });

  const hourIds = hours.map((h) => h.id);

  // payroll_batch_lines deriving from those hours.
  const lines = await db
    .select({ id: payrollBatchLines.id })
    .from(payrollBatchLines)
    .where(inArray(payrollBatchLines.shiftHoursId, hourIds));
  if (lines.length > 0) {
    holds.push({
      entityType: "payroll_batch_lines",
      count: lines.length,
      reason: "Uitbetaalde/gefactureerde loonregels horen bij de financiële administratie.",
      legalBasis: FISCAL_BASIS,
      retainUntil: latest,
    });
  }

  // shift_hour_corrections on those hours.
  const corrections = await db
    .select({ id: shiftHourCorrections.id })
    .from(shiftHourCorrections)
    .where(inArray(shiftHourCorrections.originalShiftHoursId, hourIds));
  if (corrections.length > 0) {
    holds.push({
      entityType: "shift_hour_corrections",
      count: corrections.length,
      reason: "Correcties op loonregels zijn onderdeel van de financiële administratie.",
      legalBasis: FISCAL_BASIS,
      retainUntil: latest,
    });
  }

  return holds;
}

/* ----- tombstone hashing --------------------------------------------------- */

/**
 * One-way HMAC of an email for the erasure tombstone. Reuses the rate-limit
 * HMAC secret (already required in prod). Returns null if no secret/email so
 * callers degrade gracefully (the tombstone simply stores a null hash).
 */
export function tombstoneHash(email: string | null | undefined): string | null {
  const secret = env.RATE_LIMIT_HASH_SECRET;
  if (!secret || !email) return null;
  return createHmac("sha256", secret)
    .update(`privacy_tombstone:${email.trim().toLowerCase()}`)
    .digest("hex");
}

/**
 * Has this email already been erased? Used to flag re-imports (Jotform re-submit)
 * and by the backup-replay script. Returns the matching tombstone or null.
 */
export async function findTombstoneByEmail(email: string | null | undefined) {
  const hash = tombstoneHash(email);
  if (!hash) return null;
  const [row] = await db
    .select()
    .from(privacyErasureTombstones)
    .where(eq(privacyErasureTombstones.hashedEmail, hash))
    .limit(1);
  return row ?? null;
}
