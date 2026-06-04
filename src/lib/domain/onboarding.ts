/**
 * Chef onboarding writeback (PR-FB-3) — the Stage-2 native form.
 *
 * Routes submitted values:
 *   - system field  → typed chefs column (encrypted for BSN/IBAN/ID number)
 *   - custom field  → chef_field_values EAV (typed value columns)
 *   - file field    → already a chef_documents row (created at upload); nothing
 *                     to write here, presence is just verified
 *
 * Encryption is computed BEFORE the tx (pure async); the withTx callback does
 * only DB writes, per the project's transaction contract.
 */

import { and, eq, isNull } from "drizzle-orm";

import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { chefDocuments, chefFieldValues, chefs } from "@/lib/db/schema";
import { encryptPii } from "@/lib/crypto";
import { recordConsent } from "@/lib/consent";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import { getSystemBinding } from "@/lib/forms/system-bindings";
import { maskPiiHint, toColumnValue, toEavValue } from "@/lib/forms/serialization";
import { validateForm } from "@/lib/forms/validation";
import type { FieldDTO, FormDTO, FormSubmitValue } from "@/lib/forms/types";

export const ONBOARDING_FORM_SLUG = "chef-onboarding";

export type OnboardingInitial = Record<
  string,
  { value: string | string[] | boolean | number | null; filled: boolean; filename: string | null }
>;

type ChefRow = typeof chefs.$inferSelect;

export async function getChefByUserId(userId: string): Promise<ChefRow | null> {
  const [row] = await db.select().from(chefs).where(eq(chefs.userId, userId)).limit(1);
  return row ?? null;
}

/** Latest non-deleted document per type for a chef. */
async function docsByType(chefId: string): Promise<Map<string, { filename: string }>> {
  const rows = await db
    .select({ type: chefDocuments.type, filename: chefDocuments.filename, createdAt: chefDocuments.createdAt })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.chefId, chefId), isNull(chefDocuments.deletedAt)))
    .orderBy(chefDocuments.createdAt);
  const map = new Map<string, { filename: string }>();
  for (const r of rows) map.set(r.type, { filename: r.filename }); // last (newest) wins
  return map;
}

/** Build the prefill state for the wizard. Never sends encrypted plaintext. */
export async function hydrateFormState(form: FormDTO, chef: ChefRow): Promise<OnboardingInitial> {
  const out: OnboardingInitial = {};
  const docs = await docsByType(chef.id);

  const customRows = await db
    .select()
    .from(chefFieldValues)
    .where(eq(chefFieldValues.chefId, chef.id));
  const customByFieldId = new Map(customRows.map((r) => [r.fieldId, r]));

  for (const f of flattenFields(form)) {
    if (f.kind === "system") {
      const binding = getSystemBinding(f.systemKey);
      if (!binding) {
        out[f.key] = { value: null, filled: false, filename: null };
        continue;
      }
      if (binding.target === "chef_documents") {
        const doc = binding.docType ? docs.get(binding.docType) : undefined;
        out[f.key] = { value: null, filled: Boolean(doc), filename: doc?.filename ?? null };
        continue;
      }
      const col = binding.column as keyof ChefRow | undefined;
      const raw = col ? chef[col] : null;
      if (binding.encrypted) {
        // never expose ciphertext/plaintext — only "filled"
        out[f.key] = { value: null, filled: Boolean(raw), filename: null };
      } else if (typeof raw === "boolean") {
        out[f.key] = { value: raw, filled: raw !== null, filename: null };
      } else if (raw instanceof Date) {
        out[f.key] = { value: raw.toISOString().slice(0, 10), filled: true, filename: null };
      } else {
        out[f.key] = {
          value: (raw as unknown as string | number | null) ?? null,
          filled: raw != null && raw !== "",
          filename: null,
        };
      }
    } else {
      const row = customByFieldId.get(f.id);
      let value: string | string[] | boolean | number | null = null;
      if (row) {
        if (row.isEncrypted) value = null;
        else if (row.valueBoolean !== null) value = row.valueBoolean;
        else if (row.valueNumber !== null) value = Number(row.valueNumber);
        else if (row.valueDate !== null) value = String(row.valueDate);
        else if (row.valueJson !== null) value = row.valueJson as string[];
        else value = row.valueText;
      }
      out[f.key] = { value, filled: Boolean(row), filename: null };
    }
  }
  return out;
}

/** Compute the chefs-column updates + EAV upserts for the submitted values. */
async function buildWriteback(
  form: FormDTO,
  chef: ChefRow,
  values: Record<string, FormSubmitValue>,
): Promise<{
  chefsUpdate: Record<string, unknown>;
  eavRows: Array<typeof chefFieldValues.$inferInsert>;
}> {
  const chefsUpdate: Record<string, unknown> = {};
  const eavRows: Array<typeof chefFieldValues.$inferInsert> = [];

  for (const f of flattenFields(form)) {
    const raw = values[f.key];
    const isEmpty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);

    if (f.kind === "system") {
      const binding = getSystemBinding(f.systemKey);
      if (!binding || binding.target !== "chefs" || !binding.column) continue; // files handled at upload
      if (isEmpty) continue; // never null an existing value from an empty submit
      let col = toColumnValue(binding.type, raw);
      if (col === null) continue;
      if (binding.enumValues && !binding.enumValues.includes(String(col))) continue;
      if (binding.encrypted) col = await encryptPii(String(col));
      chefsUpdate[binding.column] = col;
    } else {
      if (isEmpty) continue;
      const eav = toEavValue(f, raw);
      const row: typeof chefFieldValues.$inferInsert = {
        chefId: chef.id,
        fieldId: f.id,
        fieldKey: f.key,
        valueText: eav.valueText,
        valueNumber: eav.valueNumber,
        valueBoolean: eav.valueBoolean,
        valueDate: eav.valueDate,
        valueJson: eav.valueJson,
        isEncrypted: false,
      };
      if (f.isSensitive && eav.valueText) {
        row.valueText = await encryptPii(eav.valueText);
        row.isEncrypted = true;
      }
      eavRows.push(row);
    }
  }

  // Recompute the canonical fullName from name parts (merging new + existing).
  const first = (chefsUpdate.firstName as string) ?? chef.firstName;
  const infix = (chefsUpdate.infix as string) ?? chef.infix;
  const surname = (chefsUpdate.surname as string) ?? chef.surname;
  if (first || surname) {
    chefsUpdate.fullName = [first, infix, surname].filter(Boolean).join(" ").trim() || chef.fullName;
  }

  return { chefsUpdate, eavRows };
}

async function persist(
  chef: ChefRow,
  chefsUpdate: Record<string, unknown>,
  eavRows: Array<typeof chefFieldValues.$inferInsert>,
  extraChefSet: Record<string, unknown>,
  actorId: string,
  action: string,
): Promise<void> {
  await withTx(async (tx) => {
    await tx
      .update(chefs)
      .set({ ...chefsUpdate, ...extraChefSet, updatedAt: new Date() } as Partial<typeof chefs.$inferInsert>)
      .where(eq(chefs.id, chef.id));

    for (const row of eavRows) {
      await tx
        .insert(chefFieldValues)
        .values(row)
        .onConflictDoUpdate({
          target: [chefFieldValues.chefId, chefFieldValues.fieldId],
          set: {
            fieldKey: row.fieldKey,
            valueText: row.valueText,
            valueNumber: row.valueNumber,
            valueBoolean: row.valueBoolean,
            valueDate: row.valueDate,
            valueJson: row.valueJson,
            isEncrypted: row.isEncrypted,
            updatedAt: new Date(),
          },
        });
    }

    await recordAuditCore(
      await stampFromRequest({
        userId: actorId,
        action,
        resource: "chefs",
        resourceId: chef.id,
        after: { fields: Object.keys(chefsUpdate).length, custom: eavRows.length },
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
  const chef = await getChefByUserId(args.userId);
  if (!chef) return { ok: false, error: "no-chef" };
  const form = await getPublishedForm(ONBOARDING_FORM_SLUG);
  if (!form) return { ok: false, error: "no-form" };

  // Validate only the provided fields (so a half-filled draft can still save).
  const fields = flattenFields(form);
  const provided = fields.filter((f) => {
    const v = args.values[f.key];
    return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  });
  const fieldErrors = validateForm(provided as FieldDTO[], args.values, {});
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "validation", fieldErrors };

  const { chefsUpdate, eavRows } = await buildWriteback(form, chef, args.values);
  const extra =
    chef.onboardingStatus === "submitted" ? {} : { onboardingStatus: "in_progress" as const };
  await persist(chef, chefsUpdate, eavRows, extra, args.userId, "chef.onboarding_draft_saved");
  return { ok: true, saved: Object.keys(chefsUpdate).length + eavRows.length };
}

/** Final submit. Enforces all required + visible fields server-side. */
export async function submitOnboarding(args: {
  userId: string;
  values: Record<string, FormSubmitValue>;
  ip?: string;
  userAgent?: string;
}): Promise<
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; firstBadSectionId?: string }
> {
  const chef = await getChefByUserId(args.userId);
  if (!chef) return { ok: false, error: "no-chef" };
  const form = await getPublishedForm(ONBOARDING_FORM_SLUG);
  if (!form) return { ok: false, error: "no-form" };

  // Idempotent: a second submit is a no-op success.
  if (chef.onboardingStatus === "submitted") return { ok: true };

  const fields = flattenFields(form);

  // File presence: a required file field is satisfied if a doc of its type exists.
  const docs = await docsByType(chef.id);
  const documentIds: Record<string, string | null> = {};
  for (const f of fields) {
    if (f.type === "file") {
      const binding = getSystemBinding(f.systemKey);
      const present = binding?.docType ? docs.has(binding.docType) : false;
      documentIds[f.key] = present ? "present" : null;
    }
  }

  // Prefilled: values already stored (e.g. an encrypted BSN saved on an earlier
  // visit shows as an empty input) — count as satisfied, not "required" errors.
  const customRows = await db
    .select({ fieldId: chefFieldValues.fieldId })
    .from(chefFieldValues)
    .where(eq(chefFieldValues.chefId, chef.id));
  const customFieldIds = new Set(customRows.map((r) => r.fieldId));
  const chefRecord = chef as Record<string, unknown>;
  const prefilled = new Set<string>();
  for (const f of fields) {
    if (f.kind === "system") {
      const b = getSystemBinding(f.systemKey);
      if (b?.target === "chefs" && b.column) {
        const v = chefRecord[b.column];
        if (v != null && v !== "") prefilled.add(f.key);
      }
    } else if (customFieldIds.has(f.id)) {
      prefilled.add(f.key);
    }
  }

  const fieldErrors = validateForm(fields, args.values, documentIds, prefilled);
  if (Object.keys(fieldErrors).length > 0) {
    const firstBad = form.sections.find((s) => s.fields.some((f) => fieldErrors[f.key]));
    return { ok: false, error: "validation", fieldErrors, firstBadSectionId: firstBad?.id };
  }

  const { chefsUpdate, eavRows } = await buildWriteback(form, chef, args.values);
  await persist(
    chef,
    chefsUpdate,
    eavRows,
    {
      onboardingStatus: "submitted" as const,
      onboardingCompletedAt: new Date(),
      onboardingFormVersion: form.version,
    },
    args.userId,
    "chef.onboarding_submitted",
  );

  // Consent (outside the tx): general chef consent + special-category PII (BSN/IBAN/ID).
  await recordConsent({ userId: args.userId, kind: "chef", ip: args.ip, userAgent: args.userAgent });
  await recordConsent({ userId: args.userId, kind: "chef_onboarding", ip: args.ip, userAgent: args.userAgent });

  return { ok: true };
}

export { maskPiiHint };
