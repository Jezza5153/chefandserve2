/**
 * Form read helpers (PR-FB-2). Loads a form definition (sections → fields) and
 * maps DB rows to the renderer/builder DTOs. Server-only (touches the DB).
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { formFields, formSections, forms } from "@/lib/db/schema";
import type { FormField as DbFormField } from "@/lib/db/schema";
import type {
  FieldDTO,
  FieldOption,
  FieldType,
  FieldValidation,
  FormDTO,
} from "@/lib/forms/types";

export function toFieldDTO(row: DbFormField): FieldDTO {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    systemKey: row.systemKey,
    type: row.type as FieldType,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    required: row.required,
    isSensitive: row.isSensitive,
    options: (row.options as FieldOption[] | null) ?? null,
    validation: (row.validation as FieldValidation | null) ?? null,
    documentType: row.documentType ?? null,
  };
}

async function loadForm(
  slug: string,
  opts: { requirePublished: boolean; onlyVisible: boolean },
): Promise<FormDTO | null> {
  const [form] = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
  if (!form) return null;
  if (opts.requirePublished && form.status !== "published") return null;

  const sections = await db
    .select()
    .from(formSections)
    .where(eq(formSections.formId, form.id))
    .orderBy(asc(formSections.sortOrder));

  const fieldRows = await db
    .select()
    .from(formFields)
    .where(
      opts.onlyVisible
        ? and(eq(formFields.formId, form.id), eq(formFields.isVisible, true))
        : eq(formFields.formId, form.id),
    )
    .orderBy(asc(formFields.sortOrder));

  const bySection = new Map<string, FieldDTO[]>();
  for (const f of fieldRows) {
    const list = bySection.get(f.sectionId) ?? [];
    list.push(toFieldDTO(f));
    bySection.set(f.sectionId, list);
  }

  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    version: form.version,
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields: bySection.get(s.id) ?? [],
    })),
  };
}

/** The live form a chef fills — published + visible fields only. */
export function getPublishedForm(slug: string): Promise<FormDTO | null> {
  return loadForm(slug, { requirePublished: true, onlyVisible: true });
}

/** Any status, ALL fields (incl. hidden) — for the form-builder admin UI. */
export function getFormForBuilder(slug: string): Promise<FormDTO | null> {
  return loadForm(slug, { requirePublished: false, onlyVisible: false });
}

/** All flat fields of a form (helper for validation/writeback). */
export function flattenFields(form: FormDTO): FieldDTO[] {
  return form.sections.flatMap((s) => s.fields);
}
