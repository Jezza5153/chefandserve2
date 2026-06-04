"use server";

import { headers } from "next/headers";

import { requireAuth } from "@/lib/permissions";
import type { DocumentType } from "@/lib/domain/chef-documents";
import { requestChefDocumentUpload } from "@/lib/domain/chef-documents";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import {
  getChefByUserId,
  ONBOARDING_FORM_SLUG,
  saveOnboardingDraft,
  submitOnboarding,
} from "@/lib/domain/onboarding";
import { getSystemBinding } from "@/lib/forms/system-bindings";
import type { FormSubmitValue } from "@/lib/forms/types";

/** Presigned upload for one onboarding file field. chefId comes from the session. */
export async function requestOnboardingUpload(
  fieldId: string,
  args: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }> {
  const session = await requireAuth();
  const chef = await getChefByUserId(session.user.id);
  if (!chef) return { ok: false, error: "Geen chef-profiel gekoppeld." };

  const form = await getPublishedForm(ONBOARDING_FORM_SLUG);
  const field = form ? flattenFields(form).find((f) => f.id === fieldId) : null;
  const binding = field ? getSystemBinding(field.systemKey) : null;
  const docType = (binding?.docType ?? field?.documentType ?? "other") as DocumentType;

  const res = await requestChefDocumentUpload({
    chefId: chef.id,
    type: docType,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    uploadedBy: session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, uploadUrl: res.uploadUrl, documentId: res.documentId };
}

export async function saveDraftAction(values: Record<string, FormSubmitValue>) {
  const session = await requireAuth();
  return saveOnboardingDraft({ userId: session.user.id, values });
}

export async function submitOnboardingAction(values: Record<string, FormSubmitValue>) {
  const session = await requireAuth();
  const h = await headers();
  return submitOnboarding({
    userId: session.user.id,
    values,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  });
}
