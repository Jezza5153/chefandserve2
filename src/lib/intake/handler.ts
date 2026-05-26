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
import { env } from "@/lib/env";

import {
  extractChefSubmission,
  extractClientSubmission,
  type JotformBody,
} from "./jotform";

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

async function notifyMaarten(
  kind: IntakeKind,
  summary: {
    name?: string | null;
    email?: string | null;
    notes?: string | null;
  },
) {
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
      to: env.MAARTEN_EMAIL,
      subject,
      text,
    });
  } catch (e) {
    // Best-effort. Failure is logged separately via error_log (PR-1B).
    console.error("[intake] Maarten notification failed:", e);
  }
}

/* -------- handler ------------------------------------------------------ */

export async function handleJotformWebhook(
  request: Request,
  kind: IntakeKind,
): Promise<Response> {
  const body = await parseBody(request);

  // Step 1: ALWAYS log the raw payload to webhooks_received. Even if we later
  // fail to parse, this row is the recovery point.
  let signatureValid: boolean | null = null;
  // Jotform supports HMAC via x-jotform-signature header (optional)
  const jotformSecret = process.env.JOTFORM_WEBHOOK_SECRET;
  if (jotformSecret) {
    const sig = request.headers.get("x-jotform-signature");
    // Simple presence check — full HMAC verification needs the raw body bytes
    // which Next.js doesn't easily expose after formData parsing. Phase 1 ships
    // the audit path; full crypto verify can land in Phase 1 polish if Jotform
    // turns out to sign requests in our setup.
    signatureValid = Boolean(sig);
  }

  await db.insert(webhooksReceived).values({
    source: "jotform",
    payload: { kind, body },
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
  await notifyMaarten(kind, {
    name,
    email: row.email ?? null,
    notes: row.notes ?? null,
  });

  // Step 5: mark webhook as processed (separate query so the failure path leaves it null)
  // Not strictly necessary in v1; intentionally minimal.

  return Response.json({ ok: true, id, kind }, { status: 200 });
}
