"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { formFields, formSections, forms } from "@/lib/db/schema";
import type { FieldOption, FieldType } from "@/lib/forms/types";
import { requireAnyRole } from "@/lib/permissions";

const CUSTOM_TYPES: FieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "boolean",
  "heading",
];

function builderPath(slug: string): string {
  return `/admin/business/forms/${slug}`;
}

async function gate() {
  return requireAnyRole(["owner", "planner"], "/admin/business");
}

function slugifyKey(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "veld"
  );
}

/** Parse "value:Label" or "Label" lines into options. */
function parseOptions(raw: string): FieldOption[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [v, ...rest] = line.split(":");
      const value = slugifyKey(v);
      const label = rest.length ? rest.join(":").trim() : v.trim();
      return { value, label };
    });
}

export async function createSection(slug: string, formId: string, fd: FormData) {
  const session = await gate();
  const title = String(fd.get("title") ?? "").trim();
  if (!title) redirect(`${builderPath(slug)}?err=title`);
  const existing = await db.select({ id: formSections.id }).from(formSections).where(eq(formSections.formId, formId));
  await db.insert(formSections).values({ formId, title, sortOrder: existing.length });
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.section_created",
    resource: "forms",
    resourceId: formId,
    after: { title },
  });
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function updateSection(slug: string, sectionId: string, fd: FormData) {
  await gate();
  const title = String(fd.get("title") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim() || null;
  if (!title) redirect(`${builderPath(slug)}?err=title`);
  await db.update(formSections).set({ title, description }).where(eq(formSections.id, sectionId));
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function deleteSection(slug: string, sectionId: string) {
  const session = await gate();
  const systemFields = await db
    .select({ id: formFields.id })
    .from(formFields)
    .where(and(eq(formFields.sectionId, sectionId), eq(formFields.kind, "system")));
  if (systemFields.length > 0) redirect(`${builderPath(slug)}?err=section_has_system`);
  await db.delete(formSections).where(eq(formSections.id, sectionId));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.section_deleted",
    resource: "forms",
    resourceId: sectionId,
  });
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

/** Swap a section's sortOrder with its neighbour (dir = up | down). */
export async function moveSection(slug: string, formId: string, sectionId: string, dir: string) {
  await gate();
  const sections = await db
    .select()
    .from(formSections)
    .where(eq(formSections.formId, formId))
    .orderBy(asc(formSections.sortOrder));
  const i = sections.findIndex((s) => s.id === sectionId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= sections.length) redirect(builderPath(slug));
  await db.update(formSections).set({ sortOrder: sections[j].sortOrder }).where(eq(formSections.id, sections[i].id));
  await db.update(formSections).set({ sortOrder: sections[i].sortOrder }).where(eq(formSections.id, sections[j].id));
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function createCustomField(slug: string, formId: string, sectionId: string, fd: FormData) {
  const session = await gate();
  const label = String(fd.get("label") ?? "").trim();
  const type = String(fd.get("type") ?? "text") as FieldType;
  if (!label) redirect(`${builderPath(slug)}?err=label`);
  if (!CUSTOM_TYPES.includes(type)) redirect(`${builderPath(slug)}?err=type`);
  const required = fd.get("required") === "on";
  const helpText = String(fd.get("helpText") ?? "").trim() || null;
  const optionsRaw = String(fd.get("options") ?? "").trim();
  const options = type === "select" || type === "multiselect" ? parseOptions(optionsRaw) : null;

  let key = slugifyKey(String(fd.get("key") ?? "") || label);
  // ensure unique per form
  const taken = await db.select({ key: formFields.key }).from(formFields).where(eq(formFields.formId, formId));
  const takenSet = new Set(taken.map((t) => t.key));
  if (takenSet.has(key)) {
    let n = 2;
    while (takenSet.has(`${key}_${n}`)) n++;
    key = `${key}_${n}`;
  }

  const existing = await db.select({ id: formFields.id }).from(formFields).where(eq(formFields.sectionId, sectionId));
  await db.insert(formFields).values({
    formId,
    sectionId,
    kind: "custom",
    systemKey: null,
    type,
    key,
    label,
    helpText,
    required,
    isVisible: true,
    isSensitive: false,
    sortOrder: existing.length,
    options,
    validation: null,
    documentType: null,
  });
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.field_created",
    resource: "forms",
    resourceId: formId,
    after: { key, type },
  });
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function updateField(slug: string, fieldId: string, fd: FormData) {
  const session = await gate();
  const [field] = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
  if (!field) redirect(builderPath(slug));

  // Common edits allowed for BOTH system + custom fields.
  const label = String(fd.get("label") ?? "").trim() || field.label;
  const helpText = String(fd.get("helpText") ?? "").trim() || null;
  const placeholder = String(fd.get("placeholder") ?? "").trim() || null;
  const required = fd.get("required") === "on";
  const isVisible = fd.get("isVisible") === "on";

  const set: Partial<typeof formFields.$inferInsert> = {
    label,
    helpText,
    placeholder,
    required,
    isVisible,
    updatedAt: new Date(),
  };

  // System fields: TYPE / key / systemKey / options are LOCKED (payroll + KPIs
  // depend on them). Custom fields may change type + options.
  if (field.kind === "custom") {
    const type = String(fd.get("type") ?? field.type) as FieldType;
    if (CUSTOM_TYPES.includes(type)) set.type = type;
    if (type === "select" || type === "multiselect") {
      set.options = parseOptions(String(fd.get("options") ?? ""));
    } else {
      set.options = null;
    }
  }

  await db.update(formFields).set(set).where(eq(formFields.id, fieldId));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.field_updated",
    resource: "forms",
    resourceId: fieldId,
    after: { kind: field.kind, label, required, isVisible },
  });
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function moveField(slug: string, sectionId: string, fieldId: string, dir: string) {
  await gate();
  const fields = await db
    .select()
    .from(formFields)
    .where(eq(formFields.sectionId, sectionId))
    .orderBy(asc(formFields.sortOrder));
  const i = fields.findIndex((f) => f.id === fieldId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= fields.length) redirect(builderPath(slug));
  await db.update(formFields).set({ sortOrder: fields[j].sortOrder }).where(eq(formFields.id, fields[i].id));
  await db.update(formFields).set({ sortOrder: fields[i].sortOrder }).where(eq(formFields.id, fields[j].id));
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function deleteField(slug: string, fieldId: string) {
  const session = await gate();
  const [field] = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
  if (!field) redirect(builderPath(slug));
  if (field.kind === "system") redirect(`${builderPath(slug)}?err=system_locked`);
  await db.delete(formFields).where(eq(formFields.id, fieldId));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.field_deleted",
    resource: "forms",
    resourceId: fieldId,
  });
  revalidatePath(builderPath(slug));
  redirect(builderPath(slug));
}

export async function publishForm(slug: string, formId: string) {
  const session = await gate();
  const [form] = await db.select().from(forms).where(eq(forms.id, formId)).limit(1);
  if (!form) redirect(builderPath(slug));
  await db
    .update(forms)
    .set({ status: "published", version: form.version + 1, updatedAt: new Date() })
    .where(eq(forms.id, formId));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "forms.published",
    resource: "forms",
    resourceId: formId,
    after: { version: form.version + 1 },
  });
  revalidatePath(builderPath(slug));
  redirect(`${builderPath(slug)}?ok=published`);
}
