"use server";

import { headers } from "next/headers";

import { requireAuth } from "@/lib/permissions";
import { requestClientDocumentUpload, type ClientDocumentType } from "@/lib/domain/client-documents";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import {
  CLIENT_ONBOARDING_FORM_SLUG,
  getClientByUserId,
  saveOnboardingDraft,
  submitOnboarding,
} from "@/lib/domain/client-onboarding";
import { getClientSystemBinding } from "@/lib/forms/client-system-bindings";
import type { FormSubmitValue } from "@/lib/forms/types";

/** Presigned upload for one onboarding file field (the RI&E). clientId comes from the session. */
export async function requestOnboardingUpload(
  fieldId: string,
  args: { filename: string; mimeType: string; sizeBytes: number },
): Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }> {
  const session = await requireAuth();
  const client = await getClientByUserId(session.user.id);
  if (!client) return { ok: false, error: "Geen klant-profiel gekoppeld." };

  const form = await getPublishedForm(CLIENT_ONBOARDING_FORM_SLUG);
  const field = form ? flattenFields(form).find((f) => f.id === fieldId) : null;
  const binding = field ? getClientSystemBinding(field.systemKey) : null;
  const docType = (binding?.docType ?? "other") as ClientDocumentType;

  const res = await requestClientDocumentUpload({
    clientId: client.id,
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
