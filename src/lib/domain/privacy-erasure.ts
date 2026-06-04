/**
 * PR-AVG-2: erasure engine (art. 17 right to be forgotten).
 *
 * SOFT-FIRST, LEGAL-HOLD-AWARE, TOMBSTONED. Never a silent hard delete.
 *
 *   previewUserErasure(subject) → what will be deleted / anonymised vs retained
 *   eraseUserData(...)          → execute (identity-gated), write a tombstone
 *
 * neon-http has no interactive transaction (MEMORY.md), so erasure is a
 * SEQUENCE of idempotent single-statement UPDATEs/DELETEs: nulling a column or
 * deleting a child row is safe to re-run, so a mid-way failure can simply be
 * retried. The tombstone is written LAST as the proof-of-completion marker.
 *
 * Legal holds (getLegalHoldsForUser) are PRESERVED — shift_hours / payroll rows
 * tied to the fiscale bewaarplicht are never touched; the request closes as
 * `partially_fulfilled` with a written explanation (plan rules #5, #6, #10).
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { assertImpersonationAllowed } from "@/lib/domain/impersonation";
import {
  recordAuditCore,
  recordAuditFromRequest,
  stampFromRequest,
} from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefAvailability,
  chefDocuments,
  chefFieldValues,
  chefs,
  clientContacts,
  clients,
  notifications,
  privacyErasureTombstones,
  privacyRequests,
  profileDataRequests,
  ratings,
  users,
} from "@/lib/db/schema";
import { createNotification } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";
import { deleteObject, r2IsConfigured } from "@/lib/r2";

import {
  getLegalHoldsForUser,
  resolveSubject,
  tombstoneHash,
  type DataSubject,
  type LegalHold,
} from "./privacy-subject";

/* ----- preview ------------------------------------------------------------- */

export type ErasurePlanItem = {
  table: string;
  count: number;
  action: "anonymiseren" | "verwijderen" | "documenten wissen";
};

export type ErasurePreview = {
  willErase: ErasurePlanItem[];
  willRetain: LegalHold[];
  warnings: string[];
  documentCount: number;
};

export async function previewUserErasure(
  subject: DataSubject,
): Promise<ErasurePreview> {
  const willErase: ErasurePlanItem[] = [];
  const warnings: string[] = [];
  let documentCount = 0;

  if (subject.chefId) {
    willErase.push({ table: "chefs", count: 1, action: "anonymiseren" });

    const docs = await db
      .select({ id: chefDocuments.id })
      .from(chefDocuments)
      .where(and(eq(chefDocuments.chefId, subject.chefId), isNull(chefDocuments.deletedAt)));
    documentCount = docs.length;
    if (docs.length > 0)
      willErase.push({ table: "chef_documents", count: docs.length, action: "documenten wissen" });

    const avail = await db
      .select({ id: chefAvailability.id })
      .from(chefAvailability)
      .where(eq(chefAvailability.chefId, subject.chefId));
    if (avail.length > 0)
      willErase.push({ table: "chef_availability", count: avail.length, action: "verwijderen" });

    const rts = await db
      .select({ id: ratings.id })
      .from(ratings)
      .where(eq(ratings.chefId, subject.chefId));
    if (rts.length > 0)
      willErase.push({ table: "ratings (vrije tekst)", count: rts.length, action: "anonymiseren" });

    // PR-FB: custom onboarding field values (EAV).
    const cfv = await db
      .select({ id: chefFieldValues.id })
      .from(chefFieldValues)
      .where(eq(chefFieldValues.chefId, subject.chefId));
    if (cfv.length > 0)
      willErase.push({ table: "chef_field_values (onboarding)", count: cfv.length, action: "verwijderen" });

    // PR-2B: klant favorite/blocked lists that reference this chef.
    const favBlk = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        sql`${subject.chefId} = ANY(${clients.favoriteChefIds}) OR ${subject.chefId} = ANY(${clients.blockedChefIds})`,
      );
    if (favBlk.length > 0)
      willErase.push({ table: "klant favoriet/blokkeer", count: favBlk.length, action: "verwijderen" });
  }

  if (subject.clientId) {
    willErase.push({ table: "clients (contactpersoon)", count: 1, action: "anonymiseren" });
    if (subject.email) {
      const contacts = await db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clientId, subject.clientId),
            eq(sql`lower(${clientContacts.email})`, subject.email),
          ),
        );
      if (contacts.length > 0)
        willErase.push({ table: "client_contacts", count: contacts.length, action: "verwijderen" });
    }
  }

  if (subject.userId) {
    willErase.push({ table: "users (account)", count: 1, action: "anonymiseren" });
    const notifs = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, subject.userId));
    if (notifs.length > 0)
      willErase.push({ table: "notifications", count: notifs.length, action: "verwijderen" });
  }

  if (subject.kind === "unknown") {
    warnings.push(
      "Geen gekoppeld chef-/klantprofiel gevonden — er valt mogelijk niets te anonimiseren.",
    );
  }
  warnings.push(
    "Toestemmingslog (consent_log) blijft bewaard als bewijs dat toestemming is gegeven (verantwoordingsplicht).",
  );

  const willRetain = await getLegalHoldsForUser({
    chefId: subject.chefId,
    clientId: subject.clientId,
  });
  if (willRetain.length > 0) {
    warnings.push(
      "Een deel van de gegevens valt onder de fiscale bewaarplicht en wordt NIET gewist — het verzoek wordt 'gedeeltelijk afgehandeld'.",
    );
  }

  return { willErase, willRetain, warnings, documentCount };
}

/* ----- execute ------------------------------------------------------------- */

export async function eraseUserData(args: {
  requestId: string;
  actorId: string;
  reason: string;
  /** Test seam: injected so the smoke can simulate an R2 failure. */
  deleteObjectFn?: (key: string) => Promise<void>;
}): Promise<
  | {
      ok: true;
      outcome: "fulfilled" | "partially_fulfilled";
      retained: LegalHold[];
      failedDocuments: number;
      tombstoneId: string;
    }
  | { ok: false; error: string }
> {
  await assertImpersonationAllowed();
  const reason = args.reason.trim();
  if (!reason) return { ok: false, error: "Reden is verplicht." };

  const [req] = await db
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.id, args.requestId))
    .limit(1);
  if (!req) return { ok: false, error: "Verzoek niet gevonden." };
  if (req.identityStatus !== "verified")
    return { ok: false, error: "Identiteit is niet geverifieerd — verwijdering geblokkeerd." };
  if (req.status !== "pending" && req.status !== "in_progress")
    return { ok: false, error: "Verzoek is al afgehandeld." };

  const subject = await resolveSubject(req);
  const retained = await getLegalHoldsForUser({
    chefId: subject.chefId,
    clientId: subject.clientId,
  });

  const deleteFn = args.deleteObjectFn ?? deleteObject;
  let failedDocuments = 0;

  // ----- R2 document purge (chef path) — EXTERNAL + irreversible, BEFORE the tx.
  // Object deletes can't participate in a DB transaction; failures are counted
  // (best-effort) and surface as `partially_fulfilled`.
  if (subject.chefId) {
    const docs = await db
      .select({ id: chefDocuments.id, r2Key: chefDocuments.r2Key })
      .from(chefDocuments)
      .where(and(eq(chefDocuments.chefId, subject.chefId), isNull(chefDocuments.deletedAt)));
    for (const d of docs) {
      try {
        if (!r2IsConfigured() && !args.deleteObjectFn) throw new Error("R2 not configured");
        await deleteFn(d.r2Key);
      } catch {
        failedDocuments++;
      }
    }
  }

  const retainedSummary = retained.map((h) => ({
    entityType: h.entityType,
    count: h.count,
    retainUntil: h.retainUntil ? h.retainUntil.toISOString() : null,
    reason: h.reason,
  }));
  const outcome: "fulfilled" | "partially_fulfilled" =
    retained.length > 0 || failedDocuments > 0 ? "partially_fulfilled" : "fulfilled";
  const decisionNotes = buildDecisionNotes(retained, failedDocuments);

  // ----- atomic: anonymise (all paths) + tombstone + close + audit, one tx.
  // All-or-nothing, so a mid-way failure can never leave half-erased PII without
  // a tombstone/audit. R2 bytes were already purged above (external).
  const tombstoneId = await withTx(async (tx) => {
    // chef path
    if (subject.chefId) {
      await tx
        .update(chefDocuments)
        .set({ deletedAt: new Date() })
        .where(and(eq(chefDocuments.chefId, subject.chefId), isNull(chefDocuments.deletedAt)));

      // Anonymise the chef record (soft-delete; keep the row for retained payroll FKs).
      await tx
        .update(chefs)
        .set({
          fullName: "Verwijderde chef",
          email: null,
          phone: null,
          city: null,
          specialties: null,
          languages: null,
          segments: null,
          notes: null,
          // PR-2: structured intake PII (address + home geo) — erase too.
          street: null,
          houseNumber: null,
          postcode: null,
          latitude: null,
          longitude: null,
          // PR-FB: native onboarding PII (incl. encrypted BSN/IBAN/ID) — erase all.
          firstName: null,
          infix: null,
          surname: null,
          initials: null,
          dateOfBirth: null,
          gender: null,
          nationality: null,
          placeOfResidence: null,
          country: null,
          idType: null,
          idNumberEncrypted: null,
          idExpiresAt: null,
          bsnEncrypted: null,
          ibanEncrypted: null,
          bankAccountHolderName: null,
          loonheffingskorting: null,
          stippParticipated: null,
          stippMonths: null,
          workedForClientLast6mo: null,
          ownTransport: null,
          bio: null,
          likesMost: null,
          recentVenues: null,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(chefs.id, subject.chefId));

      await tx.delete(chefAvailability).where(eq(chefAvailability.chefId, subject.chefId));

      // PR-FB: custom onboarding field values (EAV) — delete with the chef.
      await tx.delete(chefFieldValues).where(eq(chefFieldValues.chefId, subject.chefId));

      // Ratings: strip the free-text comment, keep the numeric signal (anonymised).
      await tx
        .update(ratings)
        .set({ comment: null })
        .where(eq(ratings.chefId, subject.chefId));

      // PR-2.1: missing-data requests hold the chef's contact (sent_to) — delete them.
      await tx.delete(profileDataRequests).where(eq(profileDataRequests.chefId, subject.chefId));

      // PR-2B: drop this chef from every klant's favorite/blocked list.
      await tx
        .update(clients)
        .set({
          favoriteChefIds: sql`array_remove(${clients.favoriteChefIds}, ${subject.chefId})`,
          blockedChefIds: sql`array_remove(${clients.blockedChefIds}, ${subject.chefId})`,
          updatedAt: new Date(),
        })
        .where(
          sql`${subject.chefId} = ANY(${clients.favoriteChefIds}) OR ${subject.chefId} = ANY(${clients.blockedChefIds})`,
        );
    }

    // klant path
    if (subject.clientId) {
      // Anonymise the contact person; KEEP company/kvk/btw/billing (administration).
      await tx
        .update(clients)
        .set({
          contactName: null,
          email: null,
          phone: null,
          billingEmail: null,
          notes: null,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, subject.clientId));

      if (subject.email) {
        await tx
          .delete(clientContacts)
          .where(
            and(
              eq(clientContacts.clientId, subject.clientId),
              eq(sql`lower(${clientContacts.email})`, subject.email),
            ),
          );
      }
    }

    // account path
    if (subject.userId) {
      await tx
        .update(users)
        .set({
          // email is NOT NULL + UNIQUE + must equal lower(email) — derive from id.
          email: `deleted-${subject.userId}@erased.invalid`,
          name: "Verwijderde gebruiker",
          image: null,
          passwordHash: null,
          passwordSetAt: null,
          totpSecretEncrypted: null,
          totpEnabled: false,
          totpEnrolledAt: null,
          calendarTokenSecret: null,
          status: "disabled",
          updatedAt: new Date(),
        })
        .where(eq(users.id, subject.userId));

      await tx.delete(notifications).where(eq(notifications.userId, subject.userId));
    }

    // tombstone (proof)
    const [tomb] = await tx
      .insert(privacyErasureTombstones)
      .values({
        privacyRequestId: args.requestId,
        originalUserId: subject.userId,
        originalChefId: subject.chefId,
        originalClientId: subject.clientId,
        hashedEmail: tombstoneHash(subject.email),
        requesterKind: req.requesterKind ?? null,
        erasedBy: args.actorId,
        reason,
        retainedEntitiesSummary: retainedSummary,
      })
      .returning({ id: privacyErasureTombstones.id });

    // close the request
    await tx
      .update(privacyRequests)
      .set({
        status: outcome,
        handledBy: args.actorId,
        decisionNotes,
        updatedAt: new Date(),
      })
      .where(eq(privacyRequests.id, args.requestId));

    await recordAuditCore(
      await stampFromRequest({
        userId: args.actorId,
        action:
          outcome === "fulfilled" ? "privacy.erasure_executed" : "privacy.erasure_partial",
        resource: "privacy_requests",
        resourceId: args.requestId,
        after: {
          outcome,
          failedDocuments,
          retained: retained.map((h) => `${h.entityType}:${h.count}`),
          tombstoneId: tomb.id,
        },
      }),
      tx,
    );

    return tomb.id;
  });

  // R2 cleanup failure — alert admins (in-app + the dedicated event).
  if (failedDocuments > 0) {
    const to = await recipientsFor("erasure_r2_failure");
    await createNotification({
      userId: args.actorId,
      type: "erasure_r2_failure",
      title: "Document-bytes niet gewist",
      body: `${failedDocuments} document(en) konden niet uit R2 worden verwijderd bij verwijderverzoek ${args.requestId}. Handmatige opruiming nodig.`,
      actionUrl: `/admin/system/privacy-requests/${args.requestId}`,
      entityType: "privacy_requests",
      entityId: args.requestId,
    });
    await recordAuditFromRequest({
      userId: args.actorId,
      action: "privacy.erasure_partial",
      resource: "privacy_requests",
      resourceId: args.requestId,
      after: { reason: "r2_cleanup_failed", failedDocuments, notifiedAdmins: to.length },
    });
  }

  return {
    ok: true,
    outcome,
    retained,
    failedDocuments,
    tombstoneId,
  };
}

function buildDecisionNotes(retained: LegalHold[], failedDocuments: number): string {
  const parts: string[] = ["Gegevens geanonimiseerd/verwijderd op verzoek (art. 17)."];
  if (retained.length > 0) {
    parts.push(
      "Bewaard onder wettelijke plicht: " +
        retained.map((h) => `${h.entityType} (${h.count})`).join(", ") +
        ".",
    );
  }
  if (failedDocuments > 0) {
    parts.push(
      `LET OP: ${failedDocuments} document(en) konden niet uit R2 worden verwijderd — handmatige opruiming vereist.`,
    );
  }
  return parts.join(" ");
}
