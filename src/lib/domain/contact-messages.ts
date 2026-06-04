/**
 * Native /contact-us message submission (PR-K2-2). Replaces the old `mailto:`
 * form so the message stays inside our system. Lands a client_submissions row
 * (source 'native_contact') — it shows in /admin/business/inbox alongside
 * staffing requests — and notifies the office (best-effort).
 *
 * Fixed-shape (NOT the form builder): it's a general "stuur een bericht", not a
 * structured intake. Mirrors the validation/insert/notify shape of
 * src/lib/domain/client-requests.ts.
 */

import { db } from "@/lib/db/client";
import { clientSubmissions } from "@/lib/db/schema";

const MAX = 2000;
function s(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, MAX) : null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactInput = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  role?: string;
  message?: string;
};

export async function submitContactMessage(
  input: ContactInput,
): Promise<
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  const name = s(input.name);
  const email = s(input.email)?.toLowerCase() ?? null;
  const message = s(input.message);

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Vul je naam in.";
  if (!email || !EMAIL_RE.test(email)) fieldErrors.email = "Vul een geldig e-mailadres in.";
  if (!message) fieldErrors.message = "Vul een bericht in.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "validation", fieldErrors };

  const company = s(input.company);
  const role = s(input.role);
  const phone = s(input.phone);

  const [row] = await db
    .insert(clientSubmissions)
    .values({
      externalId: `native_${crypto.randomUUID()}`,
      source: "native_contact",
      rawPayload: { name, company, email, phone, role, message },
      companyName: company,
      contactName: name,
      email,
      phone,
      roleRequested: role,
      notes: message,
      status: "new",
    })
    .returning({ id: clientSubmissions.id });

  // Best-effort office notification (mirrors the native-request notify).
  try {
    const { recipientsForForm } = await import("@/lib/notifications");
    const to = await recipientsForForm("contact", "client_submission_received");
    if (to.length > 0) {
      const { sendEmail } = await import("@/lib/email");
      const { createElement } = await import("react");
      await sendEmail({
        to,
        subject: `✉️ Nieuw bericht via contact: ${name}`,
        react: createElement(
          "div",
          null,
          createElement("p", null, "Nieuw bericht via /contact-us."),
          createElement("p", null, `Naam: ${name}`),
          createElement("p", null, `Bedrijf: ${company ?? "—"}`),
          createElement("p", null, `E-mail: ${email}`),
          createElement("p", null, `Telefoon: ${phone ?? "—"}`),
          createElement("p", null, `Rol: ${role ?? "—"}`),
          createElement("p", null, `Bericht: ${message}`),
          createElement("p", null, "Bekijk in de inbox (/admin/business/inbox)."),
        ),
      });
    }
  } catch {
    // best-effort — the message already lives in the inbox
  }

  return { ok: true, submissionId: row.id };
}
