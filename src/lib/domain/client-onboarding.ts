/**
 * Client onboarding writeback (PR-CLIENT-ONBOARDING) — the Stage-2 native BEDRIJFSGEGEVENS form.
 * Parallel of domain/onboarding.ts (chef), retargeted for clients. Differences:
 *   - system field → typed clients column (NO encryption — no special-category data here)
 *   - contact field → fans out into ONE client_contacts row per role (1-to-many)
 *   - file field → already a client_documents row (RI&E); presence is just verified
 *   - NO custom-field EAV in v1 (the seeded form is all system fields), NO fullName recompute
 *   - non-destructive (empty never nulls an existing value; only COMPLETE contacts upsert)
 *   - lean audit (changed field KEYS + uploaded doc types — never raw contact/personal values)
 *
 * Post-completion write-gate: once submitted, the form is read-only for the klant — drafts are
 * blocked and submit is idempotent, so companyName/kvk/btw can't be silently rewritten here
 * (admin-approved changes go through client_change_requests).
 */
import { and, eq, isNull } from "drizzle-orm";

import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { clientContacts, clientDocuments, clients } from "@/lib/db/schema";
import { recordConsent } from "@/lib/consent";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import { getClientSystemBinding } from "@/lib/forms/client-system-bindings";
import { toColumnValue } from "@/lib/forms/serialization";
import { validateForm } from "@/lib/forms/validation";
import type { FieldDTO, FormDTO, FormSubmitValue } from "@/lib/forms/types";

export const CLIENT_ONBOARDING_FORM_SLUG = "client-onboarding";

export type OnboardingInitial = Record<
  string,
  { value: string | string[] | boolean | number | null; filled: boolean; filename: string | null }
>;

type ClientRow = typeof clients.$inferSelect;
type ContactDraft = { name?: string; title?: string; email?: string; phone?: string };

export async function getClientByUserId(userId: string): Promise<ClientRow | null> {
  const [row] = await db.select().from(clients).where(eq(clients.userId, userId)).limit(1);
  return row ?? null;
}

/** Document types present (non-deleted) for a client. */
async function docTypes(clientId: string): Promise<Set<string>> {
  const rows = await db
    .select({ type: clientDocuments.type })
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, clientId), isNull(clientDocuments.deletedAt)));
  return new Set(rows.map((r) => r.type));
}

/** Existing contact rows keyed by role (for prefill + completeness). */
async function contactsByRole(clientId: string): Promise<Map<string, typeof clientContacts.$inferSelect>> {
  const rows = await db.select().from(clientContacts).where(eq(clientContacts.clientId, clientId));
  const map = new Map<string, typeof clientContacts.$inferSelect>();
  for (const r of rows) map.set(r.role, r);
  return map;
}

const isEmpty = (v: FormSubmitValue): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Prefill state for the wizard (no encrypted plaintext exists here). */
export async function hydrateFormState(form: FormDTO, client: ClientRow): Promise<OnboardingInitial> {
  const out: OnboardingInitial = {};
  const docs = await docTypes(client.id);
  const contacts = await contactsByRole(client.id);

  for (const f of flattenFields(form)) {
    const binding = f.kind === "system" ? getClientSystemBinding(f.systemKey) : null;
    if (!binding) {
      out[f.key] = { value: null, filled: false, filename: null };
      continue;
    }
    if (binding.target === "client_documents") {
      const present = binding.docType ? docs.has(binding.docType) : false;
      out[f.key] = { value: null, filled: present, filename: null };
    } else if (binding.target === "client_contacts" && binding.contactRole && binding.contactField) {
      const row = contacts.get(binding.contactRole);
      const v = row ? (row[binding.contactField] as string | null) : null;
      out[f.key] = { value: v ?? null, filled: v != null && v !== "", filename: null };
    } else {
      const col = binding.column as keyof ClientRow | undefined;
      const raw = col ? client[col] : null;
      if (Array.isArray(raw)) out[f.key] = { value: raw as string[], filled: raw.length > 0, filename: null };
      else if (typeof raw === "boolean") out[f.key] = { value: raw, filled: true, filename: null };
      else if (raw instanceof Date) out[f.key] = { value: raw.toISOString().slice(0, 10), filled: true, filename: null };
      else out[f.key] = { value: (raw as string | number | null) ?? null, filled: raw != null && raw !== "", filename: null };
    }
  }
  return out;
}

/** Compute clients-column updates + per-role contact rows for the submitted values. */
function buildWriteback(
  form: FormDTO,
  client: ClientRow,
  values: Record<string, FormSubmitValue>,
): { clientsUpdate: Record<string, unknown>; contactRows: Array<typeof clientContacts.$inferInsert> } {
  const clientsUpdate: Record<string, unknown> = {};
  const contactDrafts = new Map<string, ContactDraft>();

  for (const f of flattenFields(form)) {
    if (f.kind !== "system") continue; // v1: no custom-field EAV on this form
    const binding = getClientSystemBinding(f.systemKey);
    if (!binding) continue;
    const raw = values[f.key];

    if (binding.target === "client_contacts" && binding.contactRole && binding.contactField) {
      if (isEmpty(raw)) continue;
      const d = contactDrafts.get(binding.contactRole) ?? {};
      d[binding.contactField] = String(raw).trim();
      contactDrafts.set(binding.contactRole, d);
      continue;
    }
    if (binding.target !== "clients" || !binding.column) continue; // files handled at upload
    if (isEmpty(raw)) continue; // never null an existing value from an empty submit
    if (binding.type === "multiselect") {
      clientsUpdate[binding.column] = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      continue;
    }
    const col = toColumnValue(binding.type, raw);
    if (col === null) continue;
    if (binding.enumValues && !binding.enumValues.includes(String(col))) continue;
    clientsUpdate[binding.column] = col;
  }

  // Only COMPLETE contacts (name + email — both NOT NULL) become rows; partials are dropped here
  // (submit-time validation below blocks a partially-filled contact, so nothing is silently lost).
  const contactRows: Array<typeof clientContacts.$inferInsert> = [];
  for (const [role, d] of contactDrafts) {
    if (d.name && d.email) {
      contactRows.push({ clientId: client.id, role: role as never, name: d.name, email: d.email, phone: d.phone ?? null, title: d.title ?? null });
    }
  }
  return { clientsUpdate, contactRows };
}

async function persist(
  client: ClientRow,
  clientsUpdate: Record<string, unknown>,
  contactRows: Array<typeof clientContacts.$inferInsert>,
  extraClientSet: Record<string, unknown>,
  uploadedDocTypes: string[],
  actorId: string,
  action: string,
): Promise<void> {
  await withTx(async (tx) => {
    await tx
      .update(clients)
      .set({ ...clientsUpdate, ...extraClientSet, updatedAt: new Date() } as Partial<typeof clients.$inferInsert>)
      .where(eq(clients.id, client.id));

    for (const row of contactRows) {
      await tx
        .insert(clientContacts)
        .values(row)
        .onConflictDoUpdate({
          target: [clientContacts.clientId, clientContacts.role],
          set: { name: row.name, email: row.email, phone: row.phone, title: row.title, updatedAt: new Date() },
        });
    }

    // Lean audit — KEYS + uploaded doc types only, never raw contact/personal values.
    await recordAuditCore(
      await stampFromRequest({
        userId: actorId,
        action,
        resource: "clients",
        resourceId: client.id,
        after: { changedFields: Object.keys(clientsUpdate), contactsUpserted: contactRows.map((c) => c.role), documentTypesUploaded: uploadedDocTypes },
      }),
      tx,
    );
  });
}

/** Save valid-so-far values as a draft. Does NOT enforce required fields. */
export async function saveOnboardingDraft(args: {
  userId: string;
  values: Record<string, FormSubmitValue>;
}): Promise<{ ok: true; saved: number } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const client = await getClientByUserId(args.userId);
  if (!client) return { ok: false, error: "no-client" };
  const form = await getPublishedForm(CLIENT_ONBOARDING_FORM_SLUG);
  if (!form) return { ok: false, error: "no-form" };
  if (client.onboardingStatus === "submitted") return { ok: false, error: "already-submitted" };

  const provided = flattenFields(form).filter((f) => !isEmpty(args.values[f.key]));
  const fieldErrors = validateForm(provided as FieldDTO[], args.values, {});
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "validation", fieldErrors };

  const { clientsUpdate, contactRows } = buildWriteback(form, client, args.values);
  await persist(client, clientsUpdate, contactRows, { onboardingStatus: "in_progress" as const }, [], args.userId, "client.onboarding_draft_saved");
  return { ok: true, saved: Object.keys(clientsUpdate).length + contactRows.length };
}

/** Final submit. Enforces required + visible fields + contact completeness. Idempotent. */
export async function submitOnboarding(args: {
  userId: string;
  values: Record<string, FormSubmitValue>;
  ip?: string;
  userAgent?: string;
}): Promise<
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string>; firstBadSectionId?: string }
> {
  const client = await getClientByUserId(args.userId);
  if (!client) return { ok: false, error: "no-client" };
  const form = await getPublishedForm(CLIENT_ONBOARDING_FORM_SLUG);
  if (!form) return { ok: false, error: "no-form" };
  if (client.onboardingStatus === "submitted") return { ok: true };

  const fields = flattenFields(form);
  const docs = await docTypes(client.id);
  const existingContacts = await contactsByRole(client.id);
  const clientRecord = client as Record<string, unknown>;

  // File presence + prefilled (already-saved fields count as satisfied, not "required" errors).
  const documentIds: Record<string, string | null> = {};
  const prefilled = new Set<string>();
  for (const f of fields) {
    const b = getClientSystemBinding(f.systemKey);
    if (!b) continue;
    if (f.type === "file") {
      documentIds[f.key] = b.docType && docs.has(b.docType) ? "present" : null;
    } else if (b.target === "clients" && b.column) {
      const v = clientRecord[b.column];
      if (Array.isArray(v) ? v.length > 0 : v != null && v !== "") prefilled.add(f.key);
    } else if (b.target === "client_contacts" && b.contactRole && b.contactField) {
      const row = existingContacts.get(b.contactRole);
      if (row && (row[b.contactField] as string | null)) prefilled.add(f.key);
    }
  }

  const fieldErrors = validateForm(fields, args.values, documentIds, prefilled);

  // Contact completeness: if ANY field of a contact role is filled (now or already), require its
  // name + email — never silently drop a partially-entered contact.
  const roleFields = new Map<string, FieldDTO[]>();
  for (const f of fields) {
    const b = getClientSystemBinding(f.systemKey);
    if (b?.target === "client_contacts" && b.contactRole) {
      const arr = roleFields.get(b.contactRole) ?? [];
      arr.push(f);
      roleFields.set(b.contactRole, arr);
    }
  }
  for (const [, rf] of roleFields) {
    const anyFilled = rf.some((f) => !isEmpty(args.values[f.key]) || prefilled.has(f.key));
    if (!anyFilled) continue;
    for (const f of rf) {
      const cf = getClientSystemBinding(f.systemKey)?.contactField;
      if ((cf === "name" || cf === "email") && isEmpty(args.values[f.key]) && !prefilled.has(f.key)) {
        fieldErrors[f.key] = "Naam en e-mail zijn verplicht als je dit contact invult.";
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    const firstBad = form.sections.find((s) => s.fields.some((f) => fieldErrors[f.key]));
    return { ok: false, error: "validation", fieldErrors, firstBadSectionId: firstBad?.id };
  }

  const { clientsUpdate, contactRows } = buildWriteback(form, client, args.values);
  await persist(
    client,
    clientsUpdate,
    contactRows,
    { onboardingStatus: "submitted" as const, onboardingCompletedAt: new Date(), onboardingFormVersion: form.version },
    [...docs],
    args.userId,
    "client.onboarding_submitted",
  );

  await recordConsent({ userId: args.userId, kind: "client", ip: args.ip, userAgent: args.userAgent });
  await recordConsent({ userId: args.userId, kind: "client_onboarding", ip: args.ip, userAgent: args.userAgent });
  return { ok: true };
}
