/**
 * Stage-1 klant staff request (PR-K2-1). The native replacement for the Jotform
 * "Horecapersoneel aanvragen" client form. Writes a client_submissions row
 * (source 'native_request') — NOT a client. The office triages it in the inbox
 * and, after contact, converts it to a client + shift.
 *
 * The form is fully admin-editable (custom fields) in /admin/business/forms. We
 * read the well-known field keys (full_name/company/email/phone/role_sought/
 * segment/date_needed/headcount/city/message) into structured submission columns;
 * everything submitted is also kept in raw_payload so admin-added questions are
 * never lost.
 *
 * Mirrors src/lib/domain/applications.ts (the chef-side native apply).
 */

import { db } from "@/lib/db/client";
import { clientSubmissions } from "@/lib/db/schema";
import { flattenFields, getPublishedForm } from "@/lib/domain/forms";
import type { FormSubmitValue } from "@/lib/forms/types";
import { validateForm } from "@/lib/forms/validation";

export const CLIENT_REQUEST_FORM_SLUG = "client-request";

const MAX_FIELD_LEN = 2000;

function str(v: FormSubmitValue): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_FIELD_LEN) : null;
}

/** Parse a headcount value to a sane positive integer, or null. */
function toHeadcount(v: FormSubmitValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null;
}

export async function submitClientRequest(args: {
  values: Record<string, FormSubmitValue>;
}): Promise<
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  const form = await getPublishedForm(CLIENT_REQUEST_FORM_SLUG);
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

  const [row] = await db
    .insert(clientSubmissions)
    .values({
      externalId: `native_${crypto.randomUUID()}`,
      source: "native_request",
      rawPayload: sanitized,
      companyName: str(args.values.company),
      contactName: str(args.values.full_name),
      email: str(args.values.email)?.toLowerCase() ?? null,
      phone: str(args.values.phone),
      roleRequested: str(args.values.role_sought),
      segment: str(args.values.segment),
      dateNeeded: str(args.values.date_needed),
      headcount: toHeadcount(args.values.headcount),
      location: str(args.values.city),
      notes: str(args.values.message),
      status: "new",
    })
    .returning({ id: clientSubmissions.id });

  // Best-effort office notification (mirrors the Jotform webhook notify).
  try {
    const { recipientsForForm } = await import("@/lib/notifications");
    const to = await recipientsForForm("client-request", "client_submission_received");
    if (to.length > 0) {
      const { sendEmail } = await import("@/lib/email");
      const { createElement } = await import("react");
      const company = str(args.values.company) ?? str(args.values.full_name) ?? "onbekend";
      await sendEmail({
        to,
        subject: `🏨 Nieuwe klant-aanvraag: ${company}`,
        react: createElement(
          "div",
          null,
          createElement("p", null, "Nieuwe aanvraag via /horeca-personeel-aanvragen."),
          createElement("p", null, `Bedrijf: ${company}`),
          createElement("p", null, `Contact: ${str(args.values.full_name) ?? "—"}`),
          createElement("p", null, `E-mail: ${str(args.values.email) ?? "—"}`),
          createElement("p", null, `Telefoon: ${str(args.values.phone) ?? "—"}`),
          createElement(
            "p",
            null,
            `Zoekt: ${str(args.values.role_sought) ?? "—"} · ${str(args.values.headcount) ?? "?"} pers.`,
          ),
          createElement("p", null, "Bekijk + triageer in de inbox (/admin/business/inbox)."),
        ),
      });
    }
  } catch {
    // best-effort — the submission already lives in the inbox
  }

  return { ok: true, submissionId: row.id };
}
