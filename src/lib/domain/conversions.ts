/**
 * Submission → master record conversion.
 *
 * Called from the inbox UI when Maarten clicks "Converteer naar chef/client".
 * Creates a new chef/client row, links it back to the source submission,
 * audit-logs the event.
 *
 * Conversion is one-shot — re-clicking on an already-converted submission
 * is a no-op (we re-link to the existing chef/client).
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefSubmissions,
  chefs,
  clientSubmissions,
  clients,
} from "@/lib/db/schema";

export async function convertChefSubmission(
  submissionId: string,
  actingUserId: string,
): Promise<{ chefId: string }> {
  const submission = await db.query.chefSubmissions.findFirst({
    where: eq(chefSubmissions.id, submissionId),
  });
  if (!submission) throw new Error(`Chef submission ${submissionId} not found`);

  // If already converted, return existing link (idempotent re-click).
  if (submission.convertedToChefId) {
    return { chefId: submission.convertedToChefId };
  }

  // Create chef row from submission fields. Conservative defaults: status=onboarding.
  const fullName = submission.fullName?.trim() || "(naam ontbreekt)";
  const auditBase = await stampFromRequest({
    userId: actingUserId,
    action: "chefs.create",
    resource: "chefs",
    after: { sourceSubmissionId: submission.id, fullName },
  });

  // Atomic: create chef + link the submission + audit commit together (withTx).
  const chefId = await withTx(async (tx) => {
    const [chef] = await tx
      .insert(chefs)
      .values({
        sourceSubmissionId: submission.id,
        fullName,
        email: submission.email,
        phone: submission.phone,
        city: submission.locationPreference,
        yearsExperience: submission.yearsExperience,
        notes: submission.notes,
        // PR-2: carry structured intake onto the master record.
        street: submission.street,
        houseNumber: submission.houseNumber,
        postcode: submission.postcode,
        transportMode: submission.transportMode,
        preferences: submission.preferences,
        employmentType: submission.employmentType,
        applyingAs: submission.applyingAs,
        status: "onboarding",
        createdBy: actingUserId,
      })
      .returning({ id: chefs.id });

    await tx
      .update(chefSubmissions)
      .set({
        status: "converted",
        convertedToChefId: chef.id,
        triagedAt: new Date(),
        triagedBy: actingUserId,
        updatedAt: new Date(),
      })
      .where(eq(chefSubmissions.id, submission.id));

    await recordAuditCore({ ...auditBase, resourceId: chef.id }, tx);
    return chef.id;
  });

  return { chefId };
}

export async function convertClientSubmission(
  submissionId: string,
  actingUserId: string,
): Promise<{ clientId: string }> {
  const submission = await db.query.clientSubmissions.findFirst({
    where: eq(clientSubmissions.id, submissionId),
  });
  if (!submission) throw new Error(`Client submission ${submissionId} not found`);

  if (submission.convertedToClientId) {
    return { clientId: submission.convertedToClientId };
  }

  const companyName =
    submission.companyName?.trim() ||
    submission.contactName?.trim() ||
    "(naam ontbreekt)";
  const auditBase = await stampFromRequest({
    userId: actingUserId,
    action: "clients.create",
    resource: "clients",
    after: { sourceSubmissionId: submission.id, companyName },
  });

  const clientId = await withTx(async (tx) => {
    const [client] = await tx
      .insert(clients)
      .values({
        sourceSubmissionId: submission.id,
        companyName,
        contactName: submission.contactName,
        email: submission.email,
        phone: submission.phone,
        address: submission.location,
        notes: submission.notes,
        status: "prospect",
        createdBy: actingUserId,
      })
      .returning({ id: clients.id });

    await tx
      .update(clientSubmissions)
      .set({
        status: "converted",
        convertedToClientId: client.id,
        triagedAt: new Date(),
        triagedBy: actingUserId,
        updatedAt: new Date(),
      })
      .where(eq(clientSubmissions.id, submission.id));

    await recordAuditCore({ ...auditBase, resourceId: client.id }, tx);
    return client.id;
  });

  return { clientId };
}
