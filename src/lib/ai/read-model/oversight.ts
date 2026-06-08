/**
 * Oversight read-models for the owner assistant — surface the Restricted (tool-only) data the
 * RAG corpus deliberately never indexes: the audit trail, chef-document metadata, and privacy
 * requests. ALL metadata-only + permission-gated at the tool layer:
 *   - audit.search       → action/resource/who/when ONLY (never the before/after PII payloads)
 *   - documents.list     → type/status/expiry/verified ONLY (never bytes or a download URL)
 *   - privacy.list       → type/status/due/requester ONLY (never the raw request text)
 */
import { and, desc, eq, gte, ilike, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, chefDocuments, chefs, privacyRequests, users } from "@/lib/db/schema";

const DOC_TYPE_NL: Record<string, string> = {
  cv: "CV",
  photo: "foto",
  certificate: "certificaat",
  id_document: "ID-bewijs",
  id_copy_front: "ID (voorkant)",
  id_copy_back: "ID (achterkant)",
  bsn_registration: "BSN-registratie",
  bank_card: "bankpas",
  other: "overig",
};
const DOC_STATUS_NL: Record<string, string> = {
  uploaded: "geüpload",
  needs_review: "te controleren",
  verified: "geverifieerd",
  expired: "verlopen",
  rejected: "afgekeurd",
};
const PRIVACY_TYPE_NL: Record<string, string> = {
  access: "inzage", correction: "correctie", deletion: "verwijdering", export: "export", other: "overig",
};
const PRIVACY_STATUS_NL: Record<string, string> = {
  pending: "open", in_progress: "in behandeling", fulfilled: "afgehandeld",
  rejected: "afgewezen", partially_fulfilled: "gedeeltelijk afgehandeld", withdrawn: "ingetrokken",
};
const dt = (d: Date | string) => new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/** Recent audit entries, optionally filtered. Metadata only — NEVER the before/after payloads. */
export async function searchAudit(args: { resource?: string; resourceId?: string; action?: string; sinceDays?: number; limit: number }) {
  const conds = [];
  if (args.resource) conds.push(eq(auditLog.resource, args.resource));
  if (args.resourceId) conds.push(eq(auditLog.resourceId, args.resourceId));
  if (args.action) conds.push(ilike(auditLog.action, `%${args.action}%`));
  if (args.sinceDays) conds.push(gte(auditLog.createdAt, new Date(Date.now() - args.sinceDays * 86_400_000)));

  const rows = await db
    .select({
      action: auditLog.action,
      resource: auditLog.resource,
      resourceId: auditLog.resourceId,
      at: auditLog.createdAt,
      actor: users.name,
      impersonatorId: auditLog.impersonatorUserId,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(args.limit);

  return rows.map((r) => ({
    action: r.action,
    resource: r.resource,
    resourceId: r.resourceId,
    when: dt(r.at),
    by: r.actor ?? "systeem",
    viaImpersonation: r.impersonatorId != null,
  }));
}

/** A chef's documents — METADATA only (type/status/expiry/verified). Never bytes/URLs. */
export async function chefDocumentsForAi(chefId: string) {
  const [chef] = await db.select({ name: chefs.fullName }).from(chefs).where(eq(chefs.id, chefId)).limit(1);
  if (!chef) return null;
  const rows = await db
    .select({
      type: chefDocuments.type,
      filename: chefDocuments.filename,
      status: chefDocuments.status,
      expiresAt: chefDocuments.expiresAt,
      verifiedAt: chefDocuments.verifiedAt,
      clientVisible: chefDocuments.clientVisible,
    })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.chefId, chefId), isNull(chefDocuments.deletedAt)))
    .orderBy(desc(chefDocuments.createdAt));

  const now = Date.now();
  const documents = rows.map((r) => {
    let expiry: string | null = null;
    if (r.expiresAt) {
      const ms = new Date(r.expiresAt).getTime();
      expiry = ms < now ? "verlopen" : ms - now < 30 * 86_400_000 ? `verloopt binnenkort (${day(r.expiresAt)})` : day(r.expiresAt);
    }
    return {
      type: DOC_TYPE_NL[r.type] ?? r.type,
      filename: r.filename,
      status: DOC_STATUS_NL[r.status] ?? r.status,
      verified: r.verifiedAt != null,
      clientVisible: r.clientVisible,
      expiry,
    };
  });
  return {
    chef: chef.name,
    documents,
    expiringOrExpired: documents.filter((d) => d.expiry === "verlopen" || d.expiry?.startsWith("verloopt")).length,
  };
}

/** Privacy requests — METADATA only (type/status/due/requester). Never the raw request text. */
export async function listPrivacyRequestsForAi(args: { status?: string; limit: number }) {
  const conds = [];
  if (args.status) conds.push(eq(privacyRequests.status, args.status as (typeof privacyRequests.status.enumValues)[number]));
  const rows = await db
    .select({
      type: privacyRequests.type,
      status: privacyRequests.status,
      dueDate: privacyRequests.dueDate,
      requesterName: privacyRequests.requesterName,
      requesterKind: privacyRequests.requesterKind,
      identityStatus: privacyRequests.identityStatus,
      createdAt: privacyRequests.createdAt,
    })
    .from(privacyRequests)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(privacyRequests.createdAt))
    .limit(args.limit);

  const now = Date.now();
  return rows.map((r) => ({
    type: PRIVACY_TYPE_NL[r.type] ?? r.type,
    status: PRIVACY_STATUS_NL[r.status] ?? r.status,
    requester: r.requesterName ?? (r.requesterKind ?? "onbekend"),
    identity: r.identityStatus === "verified" ? "geverifieerd" : "nog niet geverifieerd",
    due: r.dueDate ? `${day(r.dueDate)}${new Date(r.dueDate).getTime() < now ? " (verlopen!)" : ""}` : null,
    aangevraagd: day(r.createdAt),
  }));
}
