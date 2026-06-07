/**
 * Stage-1 chef application (PR-FB-5). The native replacement for the Jotform
 * "work with us" apply form. Writes a chef_submissions row (source 'native_apply')
 * — NOT a chef. The office triages it in the inbox and, after a chat, converts
 * it to a chef + sends the full Stage-2 onboarding form.
 *
 * The apply form is fully admin-editable (custom fields). We read the well-known
 * field keys (full_name/email/phone/city/applying_as/employment_type/message)
 * into structured submission columns; everything submitted is also kept in
 * raw_payload so admin-added questions are never lost.
 */

import { db } from "@/lib/db/client";
import { chefSubmissions } from "@/lib/db/schema";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import {
  ERASED_RESUBMISSION_MARKER,
  findTombstoneByEmail,
} from "@/lib/domain/privacy-subject";
import type { FormSubmitValue } from "@/lib/forms/types";
import { validateForm } from "@/lib/forms/validation";

export const APPLY_FORM_SLUG = "chef-apply";

const MAX_FIELD_LEN = 2000;

function str(v: FormSubmitValue): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_FIELD_LEN) : null;
}

export async function submitApplication(args: {
  values: Record<string, FormSubmitValue>;
}): Promise<
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  const form = await getPublishedForm(APPLY_FORM_SLUG);
  if (!form) return { ok: false, error: "no-form" };

  const fields = flattenFields(form);
  const fieldErrors = validateForm(fields, args.values);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "validation", fieldErrors };

  // Harden this PUBLIC endpoint: keep only known form-field keys in raw_payload
  // and clamp string length — defends against direct POSTs with junk / oversized
  // / unexpected keys (storage abuse + accidental over-collection).
  const allowedKeys = new Set(fields.map((f) => f.key));
  const sanitized: Record<string, FormSubmitValue> = {};
  for (const [k, val] of Object.entries(args.values)) {
    if (!allowedKeys.has(k)) continue;
    sanitized[k] =
      typeof val === "string"
        ? val.slice(0, MAX_FIELD_LEN)
        : Array.isArray(val)
          ? val.slice(0, 50).map((x) => String(x).slice(0, MAX_FIELD_LEN))
          : val;
  }

  const applyingRaw = str(args.values.applying_as);
  const employmentRaw = str(args.values.employment_type);
  const applyingAs = applyingRaw === "chef" || applyingRaw === "front_of_house" ? applyingRaw : null;
  const employmentType =
    employmentRaw === "payroll" || employmentRaw === "zzp" || employmentRaw === "both" ? employmentRaw : null;

  const email = str(args.values.email)?.toLowerCase() ?? null;

  // Dead re-import guard (AVG art. 17) — same as the Jotform webhook path. If
  // this email was already erased, QUARANTINE the application (status 'triaged'
  // + a marker the inbox shows as "needs review") instead of materialising a
  // normal 'new' submission for triage, and alert the privacy admins rather
  // than the office. The normal (non-tombstoned) path is unaffected.
  if (email) {
    const tombstone = await findTombstoneByEmail(email);
    if (tombstone) {
      const [quarantined] = await db
        .insert(chefSubmissions)
        .values({
          externalId: `native_${crypto.randomUUID()}`,
          source: "native_apply",
          rawPayload: sanitized,
          fullName: str(args.values.full_name),
          email,
          phone: str(args.values.phone),
          locationPreference: str(args.values.city),
          notes: str(args.values.message),
          applyingAs,
          employmentType,
          status: "triaged",
          rejectedReason: ERASED_RESUBMISSION_MARKER,
        })
        .returning({ id: chefSubmissions.id });

      console.warn(
        `[applications] erased subject re-submitted via /sollicitatie — quarantined, submission=${quarantined.id}`,
      );

      // Notify privacy-routable admins (mirrors domain/privacy.ts notify).
      try {
        const { recipientsFor } = await import("@/lib/notifications");
        const to = await recipientsFor("privacy_request");
        if (to.length > 0) {
          const { sendEmail } = await import("@/lib/email");
          const { recordEmailMessage } = await import("@/lib/integrations");
          const { createElement } = await import("react");
          const send = await sendEmail({
            to,
            subject: "AVG: gewiste persoon heeft zich opnieuw aangemeld",
            react: createElement(
              "div",
              null,
              createElement(
                "p",
                null,
                "Een nieuwe aanmelding via /sollicitatie komt van een e-mailadres dat eerder is gewist (art. 17).",
              ),
              createElement(
                "p",
                null,
                "De aanmelding is in quarantaine geplaatst en NIET automatisch verwerkt. Beoordeel handmatig voordat er gegevens worden vastgelegd.",
              ),
              createElement(
                "p",
                null,
                `Bekijk in inbox: /admin/business/inbox/chef/${quarantined.id}`,
              ),
            ),
          });
          if (send.ok) {
            for (const addr of to) {
              await recordEmailMessage({
                providerMessageId: send.id,
                toEmail: addr,
                template: "ErasedResubmissionAdminNotice",
                eventKey: "privacy_request",
                entityType: "chef_submission",
                entityId: quarantined.id,
              });
            }
          }
        }
      } catch {
        // best-effort — the quarantined submission already lives in the inbox
      }

      return { ok: true, submissionId: quarantined.id };
    }
  }

  const [row] = await db
    .insert(chefSubmissions)
    .values({
      externalId: `native_${crypto.randomUUID()}`,
      source: "native_apply",
      rawPayload: sanitized,
      fullName: str(args.values.full_name),
      email,
      phone: str(args.values.phone),
      locationPreference: str(args.values.city),
      notes: str(args.values.message),
      applyingAs,
      employmentType,
      status: "new",
    })
    .returning({ id: chefSubmissions.id });

  // Best-effort office notification (mirrors the Jotform webhook notify).
  try {
    const { recipientsForForm } = await import("@/lib/notifications");
    const to = await recipientsForForm("chef-apply", "chef_submission_received");
    if (to.length > 0) {
      const { sendEmail } = await import("@/lib/email");
      const { createElement } = await import("react");
      const name = str(args.values.full_name) ?? "onbekend";
      await sendEmail({
        to,
        subject: `🍳 Nieuwe chef-aanmelding: ${name}`,
        react: createElement(
          "div",
          null,
          createElement("p", null, "Nieuwe aanmelding via /sollicitatie."),
          createElement("p", null, `Naam: ${name}`),
          createElement("p", null, `E-mail: ${str(args.values.email) ?? "—"}`),
          createElement("p", null, `Telefoon: ${str(args.values.phone) ?? "—"}`),
          createElement("p", null, `Werkt als: ${applyingAs ?? "—"} · ${employmentType ?? "—"}`),
          createElement("p", null, "Bekijk + triageer in de inbox (/admin/business/inbox)."),
        ),
      });
    }
  } catch {
    // best-effort — the submission already lives in the inbox
  }

  return { ok: true, submissionId: row.id };
}
