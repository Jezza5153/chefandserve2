/**
 * Inbox access domain (PR-INBOX-ACCESS) — roles ≠ inboxes.
 *
 * The system captures mail for multiple addresses (planning@, the owners' own boxes, …).
 * super_admin maps users ↔ inboxes (/admin/system/inboxen); Berichten filters on that mapping;
 * inbound notifications go to the matched inbox's members (fallback: the owner).
 *
 * Visibility policy (deliberate):
 *  - super_admin            → always everything.
 *  - NO inboxes configured  → everything for everyone with page access (pre-config behaviour).
 *  - otherwise              → only messages addressed to an inbox the viewer has access to;
 *                             owners additionally see messages matching NO configured inbox
 *                             (the stray-mail safety net), other roles don't.
 */
import { and, asc, eq } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { inboxAccess, inboxes, users } from "@/lib/db/schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type InboxWithMembers = {
  id: string;
  address: string;
  label: string;
  members: { userId: string; name: string | null; email: string }[];
};

export async function listInboxesWithMembers(): Promise<InboxWithMembers[]> {
  const rows = await db
    .select({
      id: inboxes.id,
      address: inboxes.address,
      label: inboxes.label,
      userId: inboxAccess.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(inboxes)
    .leftJoin(inboxAccess, eq(inboxAccess.inboxId, inboxes.id))
    .leftJoin(users, eq(inboxAccess.userId, users.id))
    .orderBy(asc(inboxes.label));
  const byId = new Map<string, InboxWithMembers>();
  for (const r of rows) {
    let box = byId.get(r.id);
    if (!box) byId.set(r.id, (box = { id: r.id, address: r.address, label: r.label, members: [] }));
    if (r.userId && r.userEmail) box.members.push({ userId: r.userId, name: r.userName, email: r.userEmail });
  }
  return [...byId.values()];
}

export async function createInbox(args: {
  address: string;
  label: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = args.address.trim().toLowerCase();
  const label = args.label.trim();
  if (!EMAIL_RE.test(address)) return { ok: false, error: "Geen geldig e-mailadres." };
  if (!label) return { ok: false, error: "Label is verplicht." };
  await db.insert(inboxes).values({ address, label }).onConflictDoNothing({ target: inboxes.address });
  await recordAuditFromRequest({
    userId: args.actorId,
    action: "inboxes.created",
    resource: "inboxes",
    resourceId: address,
    after: { address, label },
  });
  return { ok: true };
}

export async function deleteInbox(args: { inboxId: string; actorId: string }): Promise<void> {
  await db.delete(inboxes).where(eq(inboxes.id, args.inboxId)); // access rows cascade
  await recordAuditFromRequest({
    userId: args.actorId,
    action: "inboxes.deleted",
    resource: "inboxes",
    resourceId: args.inboxId,
  });
}

export async function grantInboxAccess(args: {
  inboxId: string;
  userEmail: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const lower = args.userEmail.trim().toLowerCase();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, lower)).limit(1);
  if (!u) return { ok: false, error: "Geen gebruiker met dit e-mailadres." };
  await db
    .insert(inboxAccess)
    .values({ inboxId: args.inboxId, userId: u.id })
    .onConflictDoNothing({ target: [inboxAccess.inboxId, inboxAccess.userId] });
  await recordAuditFromRequest({
    userId: args.actorId,
    action: "inboxes.access_granted",
    resource: "inboxes",
    resourceId: args.inboxId,
    after: { userId: u.id },
  });
  return { ok: true };
}

export async function revokeInboxAccess(args: {
  inboxId: string;
  userId: string;
  actorId: string;
}): Promise<void> {
  await db
    .delete(inboxAccess)
    .where(and(eq(inboxAccess.inboxId, args.inboxId), eq(inboxAccess.userId, args.userId)));
  await recordAuditFromRequest({
    userId: args.actorId,
    action: "inboxes.access_revoked",
    resource: "inboxes",
    resourceId: args.inboxId,
    after: { userId: args.userId },
  });
}

export type ViewerInboxFilter =
  | { all: true }
  | { all?: undefined; addresses: string[]; configured: string[]; includeUnmatched: boolean };

/** What may this viewer see? See the policy in the file header. */
export async function viewerInboxFilter(
  userId: string,
  opts: { superAdmin: boolean; owner: boolean },
): Promise<ViewerInboxFilter> {
  if (opts.superAdmin) return { all: true };
  const all = await db.select({ address: inboxes.address, id: inboxes.id }).from(inboxes);
  if (all.length === 0) return { all: true };
  const granted = await db
    .select({ inboxId: inboxAccess.inboxId })
    .from(inboxAccess)
    .where(eq(inboxAccess.userId, userId));
  const grantedIds = new Set(granted.map((g) => g.inboxId));
  return {
    addresses: all.filter((i) => grantedIds.has(i.id)).map((i) => i.address),
    configured: all.map((i) => i.address),
    includeUnmatched: opts.owner,
  };
}

/** PURE: may a message addressed to `toEmail` be shown under this filter? */
export function matchesViewer(toEmail: string | null, filter: ViewerInboxFilter): boolean {
  if (filter.all) return true;
  const lower = (toEmail ?? "").toLowerCase();
  if (filter.addresses.some((a) => lower.includes(a))) return true;
  const matchesAnyConfigured = filter.configured.some((a) => lower.includes(a));
  return filter.includeUnmatched && !matchesAnyConfigured;
}

/** PURE: label of the configured inbox this message belongs to (badge on Berichten). */
export function inboxLabelFor(
  toEmail: string | null,
  all: { address: string; label: string }[],
): string | null {
  const lower = (toEmail ?? "").toLowerCase();
  return all.find((i) => lower.includes(i.address))?.label ?? null;
}

/** Users with access to the inbox `toEmail` belongs to (inbound-notification routing). */
export async function inboxRecipients(toEmail: string | null): Promise<string[]> {
  const lower = (toEmail ?? "").toLowerCase();
  if (!lower) return [];
  const rows = await db
    .select({ address: inboxes.address, userId: inboxAccess.userId })
    .from(inboxes)
    .innerJoin(inboxAccess, eq(inboxAccess.inboxId, inboxes.id));
  return [...new Set(rows.filter((r) => lower.includes(r.address)).map((r) => r.userId))];
}
