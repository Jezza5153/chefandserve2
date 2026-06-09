/**
 * Client-document domain operations (PR-CLIENT-ONBOARDING) — mirror of chef-documents.ts for the
 * RI&E upload on the client onboarding form. Browser direct-to-R2 via presigned PUT; private
 * bucket; row created BEFORE upload (orphan-cleanup is a future worker TODO).
 *
 * RI&E files can contain floor plans, names + safety risks — company-sensitive. Treat seriously:
 * never a public URL, short presign TTL, audit the request without dumping file metadata.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clientDocuments } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { clientDocumentKey, getDownloadUrl, getUploadUrl, isAllowedFile, r2IsConfigured } from "@/lib/r2";

export type ClientDocumentType = "rie_document" | "other";

export type UploadRequestResult =
  | { ok: true; documentId: string; uploadUrl: string; r2Key: string; expiresAt: Date }
  | { ok: false; error: string };

/** Create a client_documents row + return a presigned PUT URL. */
export async function requestClientDocumentUpload(args: {
  clientId: string;
  type: ClientDocumentType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<UploadRequestResult> {
  if (!r2IsConfigured()) return { ok: false, error: "R2 not configured yet" };

  const allowed = isAllowedFile(args.mimeType, args.sizeBytes);
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  const documentId = crypto.randomUUID();
  const r2Key = clientDocumentKey(args.clientId, args.type, documentId, args.filename);

  await db.insert(clientDocuments).values({
    id: documentId,
    clientId: args.clientId,
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
    action: "client_documents.upload_requested",
    resource: "client_documents",
    resourceId: documentId,
    // metadata only — no file contents, no personal data
    after: { clientId: args.clientId, type: args.type },
  });

  return { ok: true, documentId, uploadUrl: url, r2Key, expiresAt };
}

/** Document types a client currently has (for onboarding file-presence checks). Non-deleted. */
export async function clientDocTypes(clientId: string): Promise<Set<string>> {
  const rows = await db
    .select({ type: clientDocuments.type })
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, clientId), isNull(clientDocuments.deletedAt)));
  return new Set(rows.map((r) => r.type));
}

/** All non-deleted documents for a client, with fresh short-lived download URLs. */
export async function listClientDocuments(clientId: string) {
  const rows = await db
    .select()
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, clientId), isNull(clientDocuments.deletedAt)))
    .orderBy(clientDocuments.createdAt);
  if (!r2IsConfigured()) {
    return rows.map((r) => ({ id: r.id, type: r.type, filename: r.filename, downloadUrl: "", createdAt: r.createdAt }));
  }
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      type: r.type,
      filename: r.filename,
      downloadUrl: await getDownloadUrl(r.r2Key),
      createdAt: r.createdAt,
    })),
  );
}
