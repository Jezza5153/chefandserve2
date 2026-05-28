/**
 * Chef-document domain operations.
 *
 * Upload flow (browser direct-to-R2, no proxy):
 *   1. Client calls server action `requestChefDocumentUpload(chefId, filename, mime, size)`
 *   2. Server creates chef_documents row with random id + sanitized r2_key
 *      → returns { uploadUrl, documentId } (uploadUrl is presigned PUT)
 *   3. Browser does PUT uploadUrl with the file body
 *   4. (Optional) Client calls `confirmChefDocumentUpload(documentId)` to mark complete
 *
 * Download:
 *   - Server-rendered <Link href={await getChefDocumentDownloadUrl(docId)}>
 *   - URL is a short-lived presigned R2 GET — never exposes credentials
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefDocumentKey,
  getDownloadUrl,
  getUploadUrl,
  isAllowedFile,
  r2IsConfigured,
} from "@/lib/r2";

export type DocumentType =
  | "cv"
  | "photo"
  | "certificate"
  | "id_document"
  | "other";

export type UploadRequestResult =
  | {
      ok: true;
      documentId: string;
      uploadUrl: string;
      r2Key: string;
      expiresAt: Date;
    }
  | { ok: false; error: string };

/**
 * Create a chef_documents row + return a presigned PUT URL.
 * The row is created BEFORE the upload (in case browser uploads fail, we
 * have a way to track + retry). A cleanup worker periodically purges rows
 * with no completed upload.
 */
export async function requestChefDocumentUpload(args: {
  chefId: string;
  type: DocumentType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<UploadRequestResult> {
  if (!r2IsConfigured()) {
    return { ok: false, error: "R2 not configured yet" };
  }

  const allowed = isAllowedFile(args.mimeType, args.sizeBytes);
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  const documentId = crypto.randomUUID();
  const r2Key = chefDocumentKey(args.chefId, documentId, args.filename);

  await db.insert(chefDocuments).values({
    id: documentId,
    chefId: args.chefId,
    type: args.type,
    filename: args.filename,
    r2Key,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    uploadedBy: args.uploadedBy,
  });

  const { url, expiresAt } = await getUploadUrl(r2Key, args.mimeType);

  await recordAuditFromRequest({
    userId: args.uploadedBy,
    action: "chef_documents.upload_requested",
    resource: "chef_documents",
    resourceId: documentId,
    after: { chefId: args.chefId, type: args.type, filename: args.filename },
  });

  return { ok: true, documentId, uploadUrl: url, r2Key, expiresAt };
}

/**
 * Return all non-deleted documents for a chef, with fresh download URLs.
 */
export async function listChefDocuments(chefId: string): Promise<
  Array<{
    id: string;
    type: DocumentType;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
    downloadUrl: string;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select()
    .from(chefDocuments)
    .where(
      and(eq(chefDocuments.chefId, chefId), isNull(chefDocuments.deletedAt)),
    )
    .orderBy(chefDocuments.createdAt);

  if (!r2IsConfigured()) {
    // Without R2, we can't generate download URLs. Skip them.
    return rows.map((r) => ({
      id: r.id,
      type: r.type as DocumentType,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      downloadUrl: "",
      createdAt: r.createdAt,
    }));
  }

  // Generate fresh signed URLs (each call gets a new one — short TTL is fine)
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      type: r.type as DocumentType,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      downloadUrl: await getDownloadUrl(r.r2Key),
      createdAt: r.createdAt,
    })),
  );
}

/**
 * Soft-delete a chef document. The R2 object stays for now — a future
 * cleanup worker can purge soft-deleted docs older than 90 days.
 */
export async function softDeleteChefDocument(
  documentId: string,
  actingUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = await db.query.chefDocuments.findFirst({
    where: eq(chefDocuments.id, documentId),
  });
  if (!doc) return { ok: false, error: "Document not found" };

  await db
    .update(chefDocuments)
    .set({ deletedAt: new Date() })
    .where(eq(chefDocuments.id, documentId));

  await recordAuditFromRequest({
    userId: actingUserId,
    action: "chef_documents.deleted",
    resource: "chef_documents",
    resourceId: documentId,
  });

  return { ok: true };
}
