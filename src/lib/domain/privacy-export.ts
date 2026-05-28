/**
 * PR-AVG-2: data-export engine (art. 15 access + art. 20 portability).
 *
 * Three layers, deliberately separated so the redaction logic is testable
 * WITHOUT R2 (the smoke runs the pure functions):
 *
 *   collectUserData(subject)      → pure DB read, ALLOW-LISTED redacted projection
 *   buildExportFiles(data, opts)  → pure file map (README.html + 3 data files)
 *   buildUserDataExport(...)      → zips + uploads to R2 + audits (needs R2)
 *   createExportDownloadLink(...) → presigns on demand (~7d), audits
 *
 * Redaction is an ALLOW-LIST (we name every exported column), never a deny-list —
 * a new PII column can't leak by default. Rules enforced here mirror
 * docs/privacy/pii-inventory.md §"Redaction rules":
 *   - never raw payloads (rawPayload / payloadJson)
 *   - never private admin notes (chefs.notes, placements.notes, decisionNotes…)
 *   - never security internals (passwordHash, totp*, tokens)
 *   - linked rows: own context only; third parties stripped
 *   - ratings: aggregate only (never the counterparty/author or raw comment)
 *   - audit_log / integration_outbox / email_events: excluded wholesale
 */

import JSZip from "jszip";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  auditLog,
  chefAvailability,
  chefDocuments,
  chefSubmissions,
  chefs,
  clientContacts,
  clientChangeRequests,
  clientShiftChangeRequests,
  clientSubmissions,
  clients,
  consentLog,
  emailMessages,
  notifications,
  placementComments,
  placements,
  privacyRequests,
  profileChangeRequests,
  shiftHours,
  shiftTemplates,
  shifts,
  users,
} from "@/lib/db/schema";
import {
  EXPORT_DOWNLOAD_TTL_SECONDS,
  getDownloadUrl,
  putObject,
  r2IsConfigured,
} from "@/lib/r2";

import {
  getLegalHoldsForUser,
  resolveSubject,
  type DataSubject,
  type LegalHold,
} from "./privacy-subject";

/* ----- collected data shape ------------------------------------------------ */

export type CollectedExport = {
  generatedAt: string;
  subject: {
    kind: DataSubject["kind"];
    displayName: string | null;
    email: string | null;
    chefId: string | null;
    clientId: string | null;
    userId: string | null;
  };
  /** Section name → array/object of redacted rows the subject is entitled to. */
  sections: Record<string, unknown>;
  /** Documents need presigned URLs at file-build time — keep r2Key internal. */
  documents: Array<{
    id: string;
    type: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
    status: string;
    expiresAt: Date | null;
    createdAt: Date;
    r2Key: string;
  }>;
  legalHolds: LegalHold[];
  /** Human Dutch list of what we stripped + why (proof of art. 15(4) care). */
  redactionsApplied: string[];
  warnings: string[];
};

/* ----- collect (allow-listed projection) ----------------------------------- */

export async function collectUserData(
  subject: DataSubject,
): Promise<CollectedExport> {
  const sections: Record<string, unknown> = {};
  const redactionsApplied: string[] = [];
  const warnings: string[] = [];
  let documents: CollectedExport["documents"] = [];

  // ----- account (any kind) -----
  if (subject.userId) {
    const [acct] = await db
      .select({ email: users.email, name: users.name, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, subject.userId))
      .limit(1);
    if (acct) sections.account = acct;
    redactionsApplied.push(
      "Inloggegevens (wachtwoord-hash, 2FA-secret, kalender-token) zijn nooit opgenomen.",
    );
  }

  if (subject.kind === "chef" && subject.chefId) {
    const chefId = subject.chefId;

    const [profile] = await db
      .select({
        fullName: chefs.fullName,
        email: chefs.email,
        phone: chefs.phone,
        city: chefs.city,
        vakniveau: chefs.vakniveau,
        segments: chefs.segments,
        specialties: chefs.specialties,
        yearsExperience: chefs.yearsExperience,
        languages: chefs.languages,
        hourlyRateMinCents: chefs.hourlyRateMinCents,
        hourlyRateMaxCents: chefs.hourlyRateMaxCents,
        status: chefs.status,
        joinedAt: chefs.joinedAt,
        // ratings aggregate ONLY (never individual klant comments/authors).
        averageRating: chefs.averageRating,
        ratingCount: chefs.ratingCount,
      })
      .from(chefs)
      .where(eq(chefs.id, chefId))
      .limit(1);
    if (profile) sections.profile = profile;
    redactionsApplied.push(
      "Interne notities over jou (chefs.notes) en je Payingit-id zijn niet opgenomen (interne beoordeling/administratie).",
    );

    sections.availability = await db
      .select({
        date: chefAvailability.date,
        available: chefAvailability.available,
        notes: chefAvailability.notes,
      })
      .from(chefAvailability)
      .where(eq(chefAvailability.chefId, chefId));

    documents = await db
      .select({
        id: chefDocuments.id,
        type: chefDocuments.type,
        filename: chefDocuments.filename,
        mimeType: chefDocuments.mimeType,
        sizeBytes: chefDocuments.sizeBytes,
        status: chefDocuments.status,
        expiresAt: chefDocuments.expiresAt,
        createdAt: chefDocuments.createdAt,
        r2Key: chefDocuments.r2Key,
      })
      .from(chefDocuments)
      .where(and(eq(chefDocuments.chefId, chefId), isNull(chefDocuments.deletedAt)));

    // placements + shift context — own placement only; internal notes/score stripped.
    sections.placements = await db
      .select({
        placementStatus: placements.status,
        shiftStartsAt: shifts.startsAt,
        shiftEndsAt: shifts.endsAt,
        role: shifts.roleNeeded,
        city: shifts.city,
      })
      .from(placements)
      .innerJoin(shifts, eq(placements.shiftId, shifts.id))
      .where(eq(placements.chefId, chefId));
    redactionsApplied.push(
      "Bij plaatsingen zijn interne matching-notities en match-scores weggelaten (placements.notes / matchScore).",
    );

    // hours — own pay side only; client/admin notes + client rate stripped.
    sections.hours = await db
      .select({
        startedAt: shiftHours.startedAt,
        endedAt: shiftHours.endedAt,
        breakMinutes: shiftHours.breakMinutes,
        workedMinutes: shiftHours.workedMinutes,
        chefRateCents: shiftHours.chefRateCents,
        chefNotes: shiftHours.chefNotes,
        status: shiftHours.status,
        createdAt: shiftHours.createdAt,
      })
      .from(shiftHours)
      .where(eq(shiftHours.chefId, chefId));
    redactionsApplied.push(
      "Bij uren zijn klant-/admin-notities, het klanttarief (marge) en de identiteit van de ondertekenaar weggelaten.",
    );

    sections.ratingSummary = {
      averageRating: profile?.averageRating ?? null,
      ratingCount: profile?.ratingCount ?? 0,
      note: "Individuele beoordelingen, tags en opmerkingen zijn intern en bevatten de mening van een ander — alleen je gemiddelde wordt gedeeld.",
    };
    redactionsApplied.push(
      "Individuele beoordelingen (auteur + vrije tekst) zijn niet opgenomen — dit is data van een derde over jou.",
    );

    sections.profileChangeRequests = await db
      .select({
        field: profileChangeRequests.field,
        currentValue: profileChangeRequests.currentValue,
        proposedValue: profileChangeRequests.proposedValue,
        reason: profileChangeRequests.reason,
        status: profileChangeRequests.status,
        decidedAt: profileChangeRequests.decidedAt,
      })
      .from(profileChangeRequests)
      .where(eq(profileChangeRequests.chefId, chefId));

    // comments the chef is allowed to see (chef_visible only — never internal).
    sections.comments = await db
      .select({
        body: placementComments.body,
        authorKind: placementComments.authorKind,
        createdAt: placementComments.createdAt,
      })
      .from(placementComments)
      .innerJoin(placements, eq(placementComments.placementId, placements.id))
      .where(
        and(
          eq(placements.chefId, chefId),
          eq(placementComments.visibility, "chef_visible"),
        ),
      );
    redactionsApplied.push(
      "Interne opmerkingen (visibility=internal) bij plaatsingen zijn nooit opgenomen.",
    );
  }

  if (subject.kind === "klant" && subject.clientId) {
    const clientId = subject.clientId;

    const [profile] = await db
      .select({
        companyName: clients.companyName,
        contactName: clients.contactName,
        email: clients.email,
        phone: clients.phone,
        kvk: clients.kvk,
        btw: clients.btw,
        billingEmail: clients.billingEmail,
        paymentTermsDays: clients.paymentTermsDays,
        segment: clients.segment,
        shiftAddress: clients.shiftAddress,
        billingAddress: clients.billingAddress,
        status: clients.status,
        joinedAt: clients.joinedAt,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (profile) sections.profile = profile;
    redactionsApplied.push(
      "Interne notities (clients.notes) en het Payingit-klant-id zijn niet opgenomen.",
    );

    // own contact row only — colleagues at the same klant are redacted.
    if (subject.email) {
      sections.contact = await db
        .select({
          name: clientContacts.name,
          email: clientContacts.email,
          phone: clientContacts.phone,
          role: clientContacts.role,
        })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clientId, clientId),
            eq(sql`lower(${clientContacts.email})`, subject.email),
          ),
        );
      redactionsApplied.push(
        "Andere contactpersonen bij dezelfde klant zijn niet opgenomen (alleen jouw eigen contactgegevens).",
      );
    }

    sections.shifts = await db
      .select({
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        role: shifts.roleNeeded,
        city: shifts.city,
        headcount: shifts.headcount,
        status: shifts.status,
      })
      .from(shifts)
      .where(eq(shifts.clientId, clientId));
    redactionsApplied.push(
      "Bij shifts zijn interne notities weggelaten (shifts.notes).",
    );

    sections.templates = await db
      .select({
        roleNeeded: shiftTemplates.roleNeeded,
        dayOfWeek: shiftTemplates.dayOfWeek,
        startsAtTime: shiftTemplates.startsAtTime,
        endsAtTime: shiftTemplates.endsAtTime,
        headcount: shiftTemplates.headcount,
        active: shiftTemplates.active,
      })
      .from(shiftTemplates)
      .where(eq(shiftTemplates.clientId, clientId));

    sections.changeRequests = await db
      .select({
        field: clientChangeRequests.field,
        proposedValue: clientChangeRequests.proposedValue,
        reason: clientChangeRequests.reason,
        status: clientChangeRequests.status,
        createdAt: clientChangeRequests.createdAt,
      })
      .from(clientChangeRequests)
      .where(eq(clientChangeRequests.clientId, clientId));

    sections.shiftChangeRequests = await db
      .select({
        kind: clientShiftChangeRequests.kind,
        reason: clientShiftChangeRequests.reason,
        proposedChange: clientShiftChangeRequests.proposedChange,
        status: clientShiftChangeRequests.status,
        createdAt: clientShiftChangeRequests.createdAt,
      })
      .from(clientShiftChangeRequests)
      .where(eq(clientShiftChangeRequests.clientId, clientId));
    redactionsApplied.push(
      "Bij verzoeken zijn interne beslissingsnotities en de behandelaar weggelaten (decisionNotes / decidedBy).",
    );
  }

  // ----- common to chef + klant: consent, notifications, own DSARs, mail, intake -----
  if (subject.userId) {
    sections.consent = await db
      .select({
        documentKey: consentLog.documentKey,
        acceptedAt: consentLog.acceptedAt,
      })
      .from(consentLog)
      .where(eq(consentLog.userId, subject.userId));

    sections.notifications = await db
      .select({
        title: notifications.title,
        body: notifications.body,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, subject.userId));
  }

  // own privacy requests (by account or email).
  {
    const conds: SQL[] = [];
    if (subject.userId) conds.push(eq(privacyRequests.userId, subject.userId));
    if (subject.email)
      conds.push(eq(sql`lower(${privacyRequests.requesterEmail})`, subject.email));
    if (conds.length > 0) {
      sections.privacyRequests = await db
        .select({
          type: privacyRequests.type,
          status: privacyRequests.status,
          createdAt: privacyRequests.createdAt,
          dueDate: privacyRequests.dueDate,
        })
        .from(privacyRequests)
        .where(or(...conds));
      redactionsApplied.push(
        "Bij je eigen privacyverzoeken zijn interne identiteits-/beslissingsnotities weggelaten.",
      );
    }
  }

  // email messages addressed to the subject only (never other recipients).
  if (subject.email) {
    sections.emailMessages = await db
      .select({
        template: emailMessages.template,
        status: emailMessages.status,
        createdAt: emailMessages.createdAt,
      })
      .from(emailMessages)
      .where(eq(sql`lower(${emailMessages.toEmail})`, subject.email));
    redactionsApplied.push(
      "Alleen e-mails gericht aan jouw adres zijn opgenomen; ruwe provider-payloads (email_events) nooit.",
    );

    // intake submissions by email — structured fields only, never rawPayload.
    if (subject.kind === "chef") {
      sections.submissions = await db
        .select({
          fullName: chefSubmissions.fullName,
          email: chefSubmissions.email,
          phone: chefSubmissions.phone,
          rolesRequested: chefSubmissions.rolesRequested,
          locationPreference: chefSubmissions.locationPreference,
          notes: chefSubmissions.notes,
          createdAt: chefSubmissions.createdAt,
        })
        .from(chefSubmissions)
        .where(eq(sql`lower(${chefSubmissions.email})`, subject.email));
    } else if (subject.kind === "klant") {
      sections.submissions = await db
        .select({
          companyName: clientSubmissions.companyName,
          contactName: clientSubmissions.contactName,
          email: clientSubmissions.email,
          phone: clientSubmissions.phone,
          roleRequested: clientSubmissions.roleRequested,
          location: clientSubmissions.location,
          notes: clientSubmissions.notes,
          createdAt: clientSubmissions.createdAt,
        })
        .from(clientSubmissions)
        .where(eq(sql`lower(${clientSubmissions.email})`, subject.email));
    }
    redactionsApplied.push(
      "Ruwe Jotform-payloads (rawPayload) zijn nooit opgenomen — alleen de uitgelezen velden.",
    );
  }

  // wholesale exclusions (high third-party risk — pii-inventory).
  redactionsApplied.push(
    "Audit-log, integratie-outbox (klantfacturatie) en ruwe webhooks zijn volledig uitgesloten (data van derden / interne beveiliging).",
  );

  const legalHolds = await getLegalHoldsForUser({
    chefId: subject.chefId,
    clientId: subject.clientId,
  });

  if (subject.kind === "unknown") {
    warnings.push(
      "Geen gekoppeld chef-/klantprofiel gevonden voor deze aanvrager — alleen account-/verzoekgegevens (indien aanwezig) zijn opgenomen.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      kind: subject.kind,
      displayName: subject.displayName,
      email: subject.email,
      chefId: subject.chefId,
      clientId: subject.clientId,
      userId: subject.userId,
    },
    sections,
    documents,
    legalHolds,
    redactionsApplied,
    warnings,
  };
}

/* ----- preview (always before execute) ------------------------------------- */

export type ExportPreview = {
  tablesIncluded: string[];
  rowCounts: Record<string, number>;
  files: string[];
  legalHolds: LegalHold[];
  redactions: string[];
  warnings: string[];
  documentCount: number;
};

export const EXPORT_FILE_NAMES = [
  "README.html",
  "personal-data.json",
  "documents-manifest.json",
  "retained-data-explanation.md",
] as const;

export async function previewUserDataExport(
  subject: DataSubject,
): Promise<ExportPreview> {
  const data = await collectUserData(subject);
  const rowCounts: Record<string, number> = {};
  const tablesIncluded: string[] = [];
  for (const [key, value] of Object.entries(data.sections)) {
    tablesIncluded.push(key);
    rowCounts[key] = Array.isArray(value) ? value.length : value ? 1 : 0;
  }
  if (data.documents.length > 0) {
    tablesIncluded.push("documents");
    rowCounts.documents = data.documents.length;
  }
  return {
    tablesIncluded,
    rowCounts,
    files: [...EXPORT_FILE_NAMES],
    legalHolds: data.legalHolds,
    redactions: data.redactionsApplied,
    warnings: data.warnings,
    documentCount: data.documents.length,
  };
}

/* ----- file builder (pure) ------------------------------------------------- */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtNl(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Build the four export files. `presign` is injected so this stays pure +
 * testable: prod passes the real R2 presigner; the smoke passes a stub.
 */
export async function buildExportFiles(
  data: CollectedExport,
  opts: {
    handlerName?: string | null;
    presign?: (r2Key: string) => Promise<string | null>;
  } = {},
): Promise<Record<string, string>> {
  const presign = opts.presign;

  // documents-manifest.json — metadata + (optional) short-lived URLs, never r2Key.
  const manifest = await Promise.all(
    data.documents.map(async (d) => ({
      type: d.type,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      expiresAt: d.expiresAt,
      createdAt: d.createdAt,
      downloadUrl: presign ? await presign(d.r2Key) : null,
      downloadNote: presign
        ? "Tijdelijke link — ~7 dagen geldig."
        : "Documenten worden los aangeleverd (geen R2-link beschikbaar).",
    })),
  );

  // personal-data.json — the machine-readable (art. 20) payload.
  const personalData = {
    generatedAt: data.generatedAt,
    subject: data.subject,
    data: data.sections,
  };

  // retained-data-explanation.md — what we keep + why (art. 17 partial / 15(4)).
  const holdsMd =
    data.legalHolds.length === 0
      ? "Er zijn geen gegevens die wij wettelijk moeten bewaren voor deze aanvrager.\n"
      : data.legalHolds
          .map(
            (h) =>
              `- **${h.entityType}** (${h.count} record(s)) — ${h.reason}\n  - Grondslag: ${h.legalBasis}\n  - Bewaard tot: ${fmtNl(h.retainUntil)}`,
          )
          .join("\n");
  const retainedMd = `# Bewaarde gegevens — uitleg

Onder de AVG mag u vragen om verwijdering (art. 17). Sommige gegevens mogen of
moeten wij echter bewaren op grond van een wettelijke plicht. Hieronder staat
precies wat wij van u bewaren en waarom.

${holdsMd}

Deze gegevens worden niet voor andere doeleinden gebruikt en worden na afloop
van de bewaartermijn alsnog verwijderd.
`;

  // README.html — the human-readable (art. 15) summary.
  const redactionList = data.redactionsApplied
    .map((r) => `<li>${esc(r)}</li>`)
    .join("\n");
  const sectionList = Object.entries(data.sections)
    .map(
      ([k, v]) =>
        `<li><strong>${esc(k)}</strong>: ${Array.isArray(v) ? `${v.length} record(s)` : "1 record"}</li>`,
    )
    .join("\n");
  const holdsHtml =
    data.legalHolds.length === 0
      ? "<p>Geen wettelijk bewaarde gegevens.</p>"
      : `<ul>${data.legalHolds
          .map(
            (h) =>
              `<li><strong>${esc(h.entityType)}</strong> (${h.count}) — ${esc(h.reason)} <em>Bewaard tot ${esc(fmtNl(h.retainUntil))}.</em></li>`,
          )
          .join("")}</ul>`;

  const readme = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>Uw persoonsgegevens — Chef & Serve</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.6}h1,h2{font-family:Georgia,serif}code{background:#f4f4f4;padding:.1rem .3rem;border-radius:3px}.muted{color:#666;font-size:.9rem}</style>
</head><body>
<h1>Uw persoonsgegevens</h1>
<p class="muted">Gegenereerd op ${esc(fmtNl(new Date(data.generatedAt)))} · Betreft: ${esc(data.subject.displayName ?? data.subject.email ?? "onbekend")} · Behandelaar: ${esc(opts.handlerName ?? "Chef & Serve")}</p>

<h2>Wat zit er in dit pakket?</h2>
<ul>
<li><code>personal-data.json</code> — al uw gegevens in machine-leesbaar formaat (art. 20, dataportabiliteit).</li>
<li><code>documents-manifest.json</code> — uw geüploade documenten met tijdelijke downloadlinks.</li>
<li><code>retained-data-explanation.md</code> — wat wij wettelijk moeten bewaren en waarom.</li>
</ul>

<h2>Welke categorieën hebben wij van u?</h2>
<ul>
${sectionList || "<li>Geen gekoppelde gegevens gevonden.</li>"}
</ul>

<h2>Waarvoor gebruiken wij deze gegevens?</h2>
<p>Voor het bemiddelen en plannen van horeca-opdrachten, het verwerken van gewerkte uren en uitbetaling/facturatie, en het voldoen aan onze wettelijke (fiscale) verplichtingen.</p>

<h2>Wat hebben wij weggelaten (en waarom)?</h2>
<p>Om de rechten van anderen te beschermen (art. 15 lid 4 AVG) en om beveiligingsredenen hebben wij het volgende <strong>niet</strong> opgenomen:</p>
<ul>
${redactionList}
</ul>

<h2>Wat bewaren wij wettelijk?</h2>
${holdsHtml}

<p class="muted">Vragen over deze gegevens? Neem contact op met Chef & Serve.</p>
</body></html>`;

  return {
    "README.html": readme,
    "personal-data.json": JSON.stringify(personalData, null, 2),
    "documents-manifest.json": JSON.stringify(manifest, null, 2),
    "retained-data-explanation.md": retainedMd,
  };
}

/* ----- build + store (needs R2) -------------------------------------------- */

export function exportR2Key(requestId: string): string {
  return `privacy-exports/${requestId}/export-${Date.now()}.zip`;
}

/**
 * Generate the export package, zip it, store it in R2, stamp the request with
 * the key, and audit. Does NOT change the request status or email the requester
 * — those are deliberate, separate human steps (createExportDownloadLink +
 * decidePrivacyRequest). Blocked unless identity is verified (plan rule #2).
 */
export async function buildUserDataExport(args: {
  requestId: string;
  actorId: string;
  handlerName?: string | null;
}): Promise<
  | { ok: true; key: string; preview: ExportPreview }
  | { ok: false; error: string }
> {
  const [req] = await db
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.id, args.requestId))
    .limit(1);
  if (!req) return { ok: false, error: "Verzoek niet gevonden." };
  if (req.identityStatus !== "verified")
    return { ok: false, error: "Identiteit is niet geverifieerd — export geblokkeerd." };
  if (!r2IsConfigured())
    return { ok: false, error: "R2 is niet geconfigureerd — kan pakket niet opslaan." };

  const subject = await resolveSubject(req);
  const data = await collectUserData(subject);
  const files = await buildExportFiles(data, {
    handlerName: args.handlerName,
    presign: (key) => getDownloadUrl(key, EXPORT_DOWNLOAD_TTL_SECONDS),
  });

  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const key = exportR2Key(args.requestId);
  await putObject(key, buffer, "application/zip");

  await db
    .update(privacyRequests)
    .set({ responseFileKey: key, updatedAt: new Date() })
    .where(eq(privacyRequests.id, args.requestId));

  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.export_generated",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: {
      key,
      tables: Object.keys(data.sections),
      documentCount: data.documents.length,
      legalHolds: data.legalHolds.map((h) => `${h.entityType}:${h.count}`),
    },
  });

  const preview = await previewUserDataExport(subject);
  return { ok: true, key, preview };
}

/**
 * Presign the stored export package on demand (~7d). Never a public URL; the
 * link is short-lived and every creation is audited (plan rule #9).
 */
export async function createExportDownloadLink(args: {
  requestId: string;
  actorId: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const [req] = await db
    .select({ key: privacyRequests.responseFileKey })
    .from(privacyRequests)
    .where(eq(privacyRequests.id, args.requestId))
    .limit(1);
  if (!req?.key) return { ok: false, error: "Nog geen exportpakket gegenereerd." };
  if (!r2IsConfigured())
    return { ok: false, error: "R2 is niet geconfigureerd." };

  const url = await getDownloadUrl(req.key, EXPORT_DOWNLOAD_TTL_SECONDS);
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.export_download_link_created",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: { key: req.key, ttlSeconds: EXPORT_DOWNLOAD_TTL_SECONDS },
  });
  return { ok: true, url };
}
