/**
 * Jotform webhook receiver — shared core for both chef + client endpoints.
 *
 * Flow:
 *   1. Parse incoming form-encoded body (Jotform's standard format)
 *   2. Save raw payload to webhooks_received (always — debug/replay)
 *   3. Extract structured fields via jotform.ts mapper
 *   4. Upsert into chef_submissions or client_submissions (idempotent on externalId)
 *   5. Fire Resend notification to Maarten (best-effort — webhook still 200s if email fails)
 *   6. Return 200 OK with { ok: true, id }
 *
 * Optional Jotform HMAC verification: if JOTFORM_WEBHOOK_SECRET env var is set,
 * the handler checks the `x-jotform-signature` header. Jotform's docs recommend
 * this but don't require it. We log success/failure to webhooks_received so
 * Maarten can audit later.
 */

import { Resend } from "resend";

import { db } from "@/lib/db/client";
import {
  chefSubmissions,
  clientSubmissions,
  webhooksReceived,
  type NewChefSubmission,
  type NewClientSubmission,
} from "@/lib/db/schema";
import {
  ERASED_RESUBMISSION_MARKER,
  findTombstoneByEmail,
} from "@/lib/domain/privacy-subject";
import { env } from "@/lib/env";

import {
  extractChefSubmission,
  extractClientSubmission,
  type JotformBody,
} from "./jotform";

/* -------- erased-subject re-import notify ------------------------------ */

/**
 * Tell the privacy-routable admins that an intake arrived from an already-erased
 * email and was QUARANTINED (not auto-materialised). Mirrors the privacy notify
 * pattern in domain/privacy.ts: recipientsFor("privacy_request") → sendEmail →
 * recordEmailMessage. Best-effort: a failure here never fails the webhook 200.
 */
async function notifyErasedResubmission(args: {
  kind: IntakeKind;
  submissionId: string;
  email: string;
}) {
  try {
    const { recipientsFor } = await import("@/lib/notifications");
    const to = await recipientsFor("privacy_request");
    if (to.length === 0) return;
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
          "Er kwam een nieuwe aanmelding binnen van een e-mailadres dat eerder is gewist (art. 17).",
        ),
        createElement(
          "p",
          null,
          "De aanmelding is in quarantaine geplaatst en NIET automatisch verwerkt. Beoordeel handmatig of dit een nieuwe, rechtmatige relatie is voordat er gegevens worden vastgelegd.",
        ),
        createElement(
          "p",
          null,
          `Type: ${args.kind === "chef" ? "Chef-aanmelding" : "Klant-aanvraag"} · Bekijk in inbox: ${env.NEXT_PUBLIC_APP_URL}/admin/business/inbox/${args.kind}/${args.submissionId}`,
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
          entityType: `${args.kind}_submission`,
          entityId: args.submissionId,
        });
      }
    }
  } catch (e) {
    console.error("[intake] notifyErasedResubmission failed:", e);
  }
}

type IntakeKind = "chef" | "client";

const resend = new Resend(env.RESEND_API_KEY);

/* -------- body parsing ------------------------------------------------- */

/** Parse Jotform's form-encoded body into a flat record. */
async function parseBody(request: Request): Promise<JotformBody> {
  const contentType = request.headers.get("content-type") ?? "";
  // Jotform always sends application/x-www-form-urlencoded or multipart/form-data
  if (
    contentType.includes("form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    const obj: JotformBody = {};
    for (const [key, value] of formData.entries()) {
      const stringValue = typeof value === "string" ? value : value.name; // File → filename
      if (obj[key] === undefined) {
        obj[key] = stringValue;
      } else if (Array.isArray(obj[key])) {
        (obj[key] as string[]).push(stringValue);
      } else {
        obj[key] = [obj[key] as string, stringValue];
      }
    }
    return obj;
  }
  // Fallback for manual JSON POSTs (e.g. our own testing tools)
  if (contentType.includes("application/json")) {
    try {
      return (await request.json()) as JotformBody;
    } catch {
      return {};
    }
  }
  return {};
}

/* -------- notification ------------------------------------------------- */

async function notifySubmissionReceived(
  kind: IntakeKind,
  summary: {
    name?: string | null;
    email?: string | null;
    notes?: string | null;
  },
) {
  // PR-F1: per-event routing. Admin can change recipients in
  // /admin/system/notifications without a redeploy. Empty = no send.
  const { recipientsFor } = await import("@/lib/notifications");
  const event =
    kind === "chef" ? "chef_submission_received" : "client_submission_received";
  const to = await recipientsFor(event);
  if (to.length === 0) return; // route disabled or empty

  const subject =
    kind === "chef"
      ? `🍳 Nieuwe chef-aanmelding: ${summary.name ?? "onbekend"}`
      : `🏨 Nieuwe klant-aanvraag: ${summary.name ?? "onbekend"}`;

  const text = [
    `Type: ${kind === "chef" ? "Chef-aanmelding (work-with-us)" : "Klant-aanvraag (contact-us)"}`,
    `Naam: ${summary.name ?? "—"}`,
    `E-mail: ${summary.email ?? "—"}`,
    `Notitie: ${summary.notes ?? "—"}`,
    "",
    `Bekijk in inbox: ${env.NEXT_PUBLIC_APP_URL}/admin/business/inbox`,
  ].join("\n");

  try {
    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject,
      text,
    });
  } catch (e) {
    // Best-effort. Failure is logged separately via error_log (PR-1B).
    console.error("[intake] notifySubmissionReceived failed:", e);
  }
}

/* -------- handler ------------------------------------------------------ */

export async function handleJotformWebhook(
  request: Request,
  kind: IntakeKind,
): Promise<Response> {
  const body = await parseBody(request);

  // PR-S1C step 1: capture all incoming request headers (minus secrets).
  // Goal: identify the actual header name(s) Jotform sends so we can decide
  // HMAC vs URL-secret vs IP-allowlist in step 2 — no fantasy header names.
  const safeHeaders: Record<string, string> = {};
  const REDACT_KEYS = new Set(["authorization", "cookie", "proxy-authorization"]);
  request.headers.forEach((value, key) => {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      safeHeaders[key] = "<redacted>";
    } else {
      safeHeaders[key] = value;
    }
  });

  // Step 1: ALWAYS log the raw payload + headers to webhooks_received.
  // Even if we later fail to parse, this row is the recovery point AND the
  // source of truth for "what does Jotform actually send".
  let signatureValid: boolean | null = null;
  // S1C step 2/3 hooks: HMAC verification gated behind two env vars.
  // Step 1 leaves both unset so we only INSTRUMENT — no enforcement yet.
  const jotformSecret = process.env.JOTFORM_WEBHOOK_SECRET;
  if (jotformSecret) {
    const sig = request.headers.get("x-jotform-signature");
    // Presence-only audit until step 2 lands real HMAC compute over raw bytes.
    signatureValid = Boolean(sig);
  }

  await db.insert(webhooksReceived).values({
    source: "jotform",
    payload: { kind, body },
    headers: safeHeaders,
    signatureValid,
    processedAt: null,
  });

  // Step 2: extract structured fields
  let row:
    | Omit<NewChefSubmission, "id" | "createdAt" | "updatedAt">
    | Omit<NewClientSubmission, "id" | "createdAt" | "updatedAt">;
  try {
    row =
      kind === "chef"
        ? extractChefSubmission(body)
        : extractClientSubmission(body);
  } catch (e) {
    console.error(`[intake/${kind}] extract failed:`, e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "extract failed" },
      { status: 400 },
    );
  }

  // Step 2.5: dead re-import guard (AVG art. 17). If this intake's email was
  // already erased, do NOT auto-materialise it. The raw body is already logged
  // to webhooks_received above (recovery point); here we QUARANTINE a submission
  // shell (status 'triaged' + a marker the inbox shows as "needs review") and
  // SKIP the normal master-record upsert, then alert the privacy admins. The
  // normal (non-tombstoned) path below is untouched.
  const subjectEmail = row.email?.trim().toLowerCase() ?? null;
  if (subjectEmail) {
    const tombstone = await findTombstoneByEmail(subjectEmail);
    if (tombstone) {
      // Plain insert (NOT onConflictDoUpdate) so a live record is never
      // refreshed from the erased subject. onConflictDoNothing keeps a Jotform
      // retry idempotent: a second delivery of the same submission is a no-op.
      let quarantinedId: string | undefined;
      if (kind === "chef") {
        const chefRow = row as Omit<NewChefSubmission, "id" | "createdAt" | "updatedAt">;
        const [q] = await db
          .insert(chefSubmissions)
          .values({ ...chefRow, status: "triaged", rejectedReason: ERASED_RESUBMISSION_MARKER })
          .onConflictDoNothing({
            target: [chefSubmissions.source, chefSubmissions.externalId],
          })
          .returning({ id: chefSubmissions.id });
        quarantinedId = q?.id;
      } else {
        const clientRow = row as Omit<NewClientSubmission, "id" | "createdAt" | "updatedAt">;
        const [q] = await db
          .insert(clientSubmissions)
          .values({ ...clientRow, status: "triaged", rejectedReason: ERASED_RESUBMISSION_MARKER })
          .onConflictDoNothing({
            target: [clientSubmissions.source, clientSubmissions.externalId],
          })
          .returning({ id: clientSubmissions.id });
        quarantinedId = q?.id;
      }

      console.warn(
        `[intake/${kind}] erased subject re-submitted — quarantined (geen master-record), submission=${quarantinedId ?? "(bestond al)"}`,
      );

      // Notify privacy admins only on the FIRST capture (a returned row).
      if (quarantinedId) {
        await notifyErasedResubmission({
          kind,
          submissionId: quarantinedId,
          email: subjectEmail,
        });
      }

      // Return 200 (the webhook succeeded) WITHOUT running the normal upsert or
      // the Maarten submission notify.
      return Response.json(
        { ok: true, quarantined: true, kind },
        { status: 200 },
      );
    }
  }

  // Step 3: idempotent upsert (on (source, externalId))
  let id: string;
  let name: string | null | undefined;
  if (kind === "chef") {
    const chefRow = row as Omit<NewChefSubmission, "id" | "createdAt" | "updatedAt">;
    const [inserted] = await db
      .insert(chefSubmissions)
      .values(chefRow)
      .onConflictDoUpdate({
        target: [chefSubmissions.source, chefSubmissions.externalId],
        set: {
          rawPayload: chefRow.rawPayload,
          // Re-extract structured fields in case Jotform sent corrections
          fullName: chefRow.fullName,
          email: chefRow.email,
          phone: chefRow.phone,
          rolesRequested: chefRow.rolesRequested,
          yearsExperience: chefRow.yearsExperience,
          locationPreference: chefRow.locationPreference,
          notes: chefRow.notes,
          updatedAt: new Date(),
        },
      })
      .returning({ id: chefSubmissions.id, fullName: chefSubmissions.fullName });
    id = inserted.id;
    name = inserted.fullName;
  } else {
    const clientRow = row as Omit<NewClientSubmission, "id" | "createdAt" | "updatedAt">;
    const [inserted] = await db
      .insert(clientSubmissions)
      .values(clientRow)
      .onConflictDoUpdate({
        target: [clientSubmissions.source, clientSubmissions.externalId],
        set: {
          rawPayload: clientRow.rawPayload,
          companyName: clientRow.companyName,
          contactName: clientRow.contactName,
          email: clientRow.email,
          phone: clientRow.phone,
          roleRequested: clientRow.roleRequested,
          segment: clientRow.segment,
          dateNeeded: clientRow.dateNeeded,
          headcount: clientRow.headcount,
          location: clientRow.location,
          notes: clientRow.notes,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: clientSubmissions.id,
        companyName: clientSubmissions.companyName,
        contactName: clientSubmissions.contactName,
      });
    id = inserted.id;
    name = inserted.companyName ?? inserted.contactName;
  }

  // Step 4: best-effort Resend notification to Maarten
  await notifySubmissionReceived(kind, {
    name,
    email: row.email ?? null,
    notes: row.notes ?? null,
  });

  // Step 5: mark webhook as processed (separate query so the failure path leaves it null)
  // Not strictly necessary in v1; intentionally minimal.

  return Response.json({ ok: true, id, kind }, { status: 200 });
}
