import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditCore, recordAuditFromRequest, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefSubmissions,
  chefs,
  profileChangeRequests,
  users,
  vakniveauEnum,
} from "@/lib/db/schema";
import { isValidEmail } from "@/lib/forms/validation";
import {
  listChefDocuments,
  requestChefDocumentUpload,
  softDeleteChefDocument,
  type DocumentType,
} from "@/lib/domain/chef-documents";
import {
  activatePortalUser,
  disablePortalUser,
  inviteChefToPortal,
} from "@/lib/domain/portal-invites";
import {
  getChefFeedbackSummary,
  getChefRecentShifts,
  getChefWorkSummary,
} from "@/lib/domain/chef-history";
import { getChefDailySeries } from "@/lib/domain/metrics-history";
import { buildChefTrends } from "@/lib/domain/chef-trends";
import { getOnboardingReadiness, getProfileCompleteness } from "@/lib/domain/profile-completeness";
import { getChefReliability } from "@/lib/chef-events";
import {
  createProfileDataRequest,
  listProfileDataRequests,
} from "@/lib/domain/profile-data-requests";
import { getChefAverageForAdmin } from "@/lib/domain/ratings";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { requirePermission } from "@/lib/permissions";
import { r2IsConfigured } from "@/lib/r2";
import { DetailShell } from "@/components/ui/DetailShell";

import { RatingSummary } from "./_components/RatingSummary";
import {
  ChangeRequests,
  chefChangeFieldLabel,
  formatChefChangeValue,
} from "./_components/ChangeRequests";
import { BasicsForm } from "./_components/BasicsForm";
import { PortalAccess } from "./_components/PortalAccess";
import { DocumentsSection } from "./_components/DocumentsSection";
import { Chef360 } from "./_components/Chef360";

export const metadata = { title: "Chef" };

const DOC_TYPE_LABELS: Record<string, string> = {
  cv: "CV",
  photo: "Foto",
  certificate: "Certificaat",
  id_document: "ID-bewijs",
  other: "Overig",
};

const VAKNIVEAU_OPTIONS = [
  "keukenhulp",
  "bediening",
  "host",
  "runner",
  "commis",
  "chef_de_partie",
  "sous_chef",
  "chef_de_cuisine",
  "executive_chef",
  "patissier",
  "banqueting",
  "breakfast",
  "roomservice",
  "other",
] as const;

const SEGMENT_OPTIONS = [
  "casual",
  "fine_dining",
  "hotel",
  "banqueting",
  "catering",
  "event",
  "corporate",
  "michelin",
] as const;

export default async function ChefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("chefs", "write");
  const { id } = await params;

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, id) });
  if (!chef) notFound();

  // PR-KLANT-5: rating summary (admin always sees full picture).
  const rating = await getChefAverageForAdmin(id);

  // PR-CHEF-4 (admin review): chef-submitted profile change requests.
  const changeRequests = await db
    .select()
    .from(profileChangeRequests)
    .where(eq(profileChangeRequests.chefId, id))
    .orderBy(desc(profileChangeRequests.createdAt))
    .limit(25);
  const pendingChanges = changeRequests.filter((r) => r.status === "pending");
  const decidedChanges = changeRequests.filter((r) => r.status !== "pending");

  // Load originating submission (if any) for "back to inbox" link
  const sourceSubmission = chef.sourceSubmissionId
    ? await db.query.chefSubmissions.findFirst({
        where: eq(chefSubmissions.id, chef.sourceSubmissionId),
      })
    : null;

  // Portal-user link (if invited)
  const portalUser = chef.userId
    ? await db.query.users.findFirst({ where: eq(users.id, chef.userId) })
    : null;

  // PR-1.6: Chef 360 read model (hours from FINAL hours only · feedback from
  // real ratings · reliability = raw counts).
  const [workSummary, feedback, recentShifts, reliability, chefSeries] = await Promise.all([
    getChefWorkSummary(id),
    getChefFeedbackSummary(id),
    getChefRecentShifts(id, 8),
    getChefReliability(id),
    getChefDailySeries(id, 90), // KPI-2: 90d of snapshot rows → 8-week trends
  ]);
  // KPI-2: pure trend layer over the snapshot rows (sparklines + noise-guarded deltas
  // + honest churn signal). Rendered alongside the point-in-time numbers below.
  const trends = buildChefTrends(chefSeries);

  // PR-2: profile completeness over the structured intake fields.
  const completeness = getProfileCompleteness({
    vakniveau: chef.vakniveau,
    city: chef.city,
    segments: chef.segments,
    yearsExperience: chef.yearsExperience,
    hourlyRateMinCents: chef.hourlyRateMinCents,
    hourlyRateMaxCents: chef.hourlyRateMaxCents,
    email: chef.email,
    phone: chef.phone,
    specialties: chef.specialties,
    languages: chef.languages,
    postcode: chef.postcode,
    transportMode: chef.transportMode,
    preferences: chef.preferences,
  });

  // PR-2.1: missing-data request history + send-form action.
  const dataRequests = await listProfileDataRequests(id);

  async function doRequestData(formData: FormData) {
    "use server";
    const session = await requirePermission("chefs", "write");
    const fields = String(formData.get("fields") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const channel = String(formData.get("channel") ?? "email") as "email" | "whatsapp" | "phone";
    await createProfileDataRequest({ chefId: id, requestedFields: fields, channel, createdBy: session.user.id });
    redirect(`/admin/business/chefs/${id}`);
  }

  // Documents (with fresh presigned download URLs)
  const documents = await listChefDocuments(chef.id);

  // PR-KPI: onboarding readiness (payroll/identity data + ID expiry).
  const hasIdFront = documents.some((d) => d.type === "id_copy_front");
  const hasIdBack = documents.some((d) => d.type === "id_copy_back");
  const onboarding = getOnboardingReadiness({
    firstName: chef.firstName,
    surname: chef.surname,
    dateOfBirth: chef.dateOfBirth,
    bsnFilled: !!chef.bsnEncrypted,
    ibanFilled: !!chef.ibanEncrypted,
    bankAccountHolderName: chef.bankAccountHolderName,
    idType: chef.idType,
    idNumberFilled: !!chef.idNumberEncrypted,
    idExpiresAt: chef.idExpiresAt,
    street: chef.street,
    houseNumber: chef.houseNumber,
    postcode: chef.postcode,
    applyingAs: chef.applyingAs,
    employmentType: chef.employmentType,
    hasIdFront,
    hasIdBack,
  });
  const r2Ready = r2IsConfigured();

  /* ---------- document server actions ----------------------- */
  async function uploadRequest(args: {
    chefId: string;
    type: DocumentType;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    "use server";
    const session = await requirePermission("chefs", "write");
    return requestChefDocumentUpload({
      ...args,
      uploadedBy: session.user.id,
    });
  }

  async function deleteDocument(formData: FormData) {
    "use server";
    const session = await requirePermission("chefs", "write");
    const documentId = String(formData.get("documentId") ?? "");
    if (!documentId) return;
    await softDeleteChefDocument(documentId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- server actions ----------------------------------- */
  async function doInviteToPortal() {
    "use server";
    const session = await requirePermission("chefs", "write");
    const result = await inviteChefToPortal(id, session.user.id);
    if (!result.ok) {
      throw new Error(result.error);
    }
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doActivatePortal() {
    "use server";
    const session = await requirePermission("chefs", "write");
    if (!chef!.userId) throw new Error("Chef has no portal user yet");
    await activatePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doDisablePortal() {
    "use server";
    const session = await requirePermission("chefs", "write");
    if (!chef!.userId) return;
    await disablePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- server actions ----------------------------------- */
  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requirePermission("chefs", "write");
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const city = String(formData.get("city") ?? "").trim() || null;
    const yearsExperience = formData.get("yearsExperience")
      ? Number(formData.get("yearsExperience"))
      : null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const status = String(formData.get("status") ?? "onboarding") as
      | "onboarding"
      | "active"
      | "paused"
      | "inactive"
      | "archived";

    // Vakniveau editor fields
    const vakniveau =
      (String(formData.get("vakniveau") ?? "") || null) as
        | (typeof VAKNIVEAU_OPTIONS)[number]
        | null;
    // segments is multi-select — formData.getAll returns string[]
    const segments = formData
      .getAll("segments")
      .map((s) => String(s))
      .filter(Boolean);
    const specialties =
      String(formData.get("specialties") ?? "").trim() || null;
    const languages = String(formData.get("languages") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const hourlyRateMin = formData.get("hourlyRateMinEur")
      ? Math.round(Number(formData.get("hourlyRateMinEur")) * 100)
      : null;
    const hourlyRateMax = formData.get("hourlyRateMaxEur")
      ? Math.round(Number(formData.get("hourlyRateMaxEur")) * 100)
      : null;

    await db
      .update(chefs)
      .set({
        fullName,
        email,
        phone,
        city,
        yearsExperience,
        notes,
        status,
        vakniveau,
        segments: segments.length > 0 ? segments : null,
        specialties,
        languages: languages.length > 0 ? languages : null,
        hourlyRateMinCents: hourlyRateMin,
        hourlyRateMaxCents: hourlyRateMax,
        updatedAt: new Date(),
      })
      .where(eq(chefs.id, id));

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "chefs.update",
      resource: "chefs",
      resourceId: id,
    });

    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- PR-CHEF-4 admin review: decide profile change requests ----- */
  async function decideProfileChange(
    formData: FormData,
    decision: "approved" | "rejected",
  ) {
    "use server";
    const session = await requirePermission("chefs", "write");
    const requestId = String(formData.get("requestId") ?? "");
    const decisionNotes =
      String(formData.get("decisionNotes") ?? "").trim() || null;
    if (!requestId) return;

    const [req] = await db
      .select()
      .from(profileChangeRequests)
      .where(eq(profileChangeRequests.id, requestId))
      .limit(1);
    if (!req || req.chefId !== id || req.status !== "pending") {
      redirect(`/admin/business/chefs/${id}?err=request-gone`);
    }

    // Validate the proposed value BEFORE applying (no raw DB throw on bad input).
    // Only relevant on approval — a rejection writes no master-table field.
    const pv = req.proposedValue as unknown;
    const proposedEmail =
      decision === "approved" && req.field === "email"
        ? String(pv ?? "").trim().toLowerCase()
        : null;
    if (decision === "approved") {
      if (req.field === "vakniveau") {
        // vakniveau is a pg enum — reject anything outside it (avoids a 22P02).
        if (!(vakniveauEnum.enumValues as readonly string[]).includes(String(pv))) {
          redirect(`/admin/business/chefs/${id}?err=ongeldig-vakniveau`);
        }
      } else if (req.field === "email" && proposedEmail) {
        if (!isValidEmail(proposedEmail)) {
          redirect(`/admin/business/chefs/${id}?err=ongeldig-emailadres`);
        }
        // Uniqueness against the login table (users.email is UNIQUE — a clash
        // would 500 inside the tx). Exclude the chef's own linked user.
        const clash = await db
          .select({ id: users.id })
          .from(users)
          .where(
            chef!.userId
              ? and(eq(users.email, proposedEmail), ne(users.id, chef!.userId))
              : eq(users.email, proposedEmail),
          )
          .limit(1);
        if (clash.length > 0) {
          redirect(`/admin/business/chefs/${id}?err=emailadres-in-gebruik`);
        }
      }
    }

    // Atomic: apply the master-table field + flip the status in ONE tx (so a
    // partial apply can't outlive a failed/stale transition). Audit commits in
    // the same tx. redirect() stays OUTSIDE (it throws → would roll back).
    const auditBase = await stampFromRequest({
      userId: session.user.id,
      action:
        decision === "approved"
          ? "chef.profile_change_approved"
          : "chef.profile_change_rejected",
      resource: "profile_change_requests",
      resourceId: requestId,
      after: { field: req.field, decision, decisionNotes },
    });
    const result = await withTx(async (tx) => {
      // Guard first: only a still-pending request flips. Zero rows → stale.
      const flipped = await tx
        .update(profileChangeRequests)
        .set({
          status: decision,
          decidedAt: new Date(),
          decidedBy: session.user.id,
          decisionNotes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(profileChangeRequests.id, requestId),
            eq(profileChangeRequests.status, "pending"),
          ),
        )
        .returning({ id: profileChangeRequests.id });
      if (flipped.length === 0) return { ok: false as const };

      // Apply the validated proposed value (only when approved).
      if (decision === "approved") {
        if (req.field === "hourlyRate" && pv && typeof pv === "object") {
          const { min, max } = pv as { min?: number; max?: number };
          await tx
            .update(chefs)
            .set({
              hourlyRateMinCents: typeof min === "number" ? min : null,
              hourlyRateMaxCents: typeof max === "number" ? max : null,
              updatedAt: new Date(),
            })
            .where(eq(chefs.id, id));
        } else if (req.field === "fullName") {
          await tx
            .update(chefs)
            .set({ fullName: String(pv), updatedAt: new Date() })
            .where(eq(chefs.id, id));
        } else if (req.field === "email" && proposedEmail) {
          await tx
            .update(chefs)
            .set({ email: proposedEmail, updatedAt: new Date() })
            .where(eq(chefs.id, id));
          // Keep the portal-login email in sync — chefs.email is the login
          // address (mirrored to users.email at invite time), so an approved
          // email change must follow through to users or login silently drifts.
          if (chef!.userId) {
            await tx
              .update(users)
              .set({ email: proposedEmail, updatedAt: new Date() })
              .where(eq(users.id, chef!.userId));
          }
        } else if (req.field === "vakniveau") {
          await tx
            .update(chefs)
            .set({ vakniveau: String(pv) as never, updatedAt: new Date() })
            .where(eq(chefs.id, id));
        }
      }

      await recordAuditCore(auditBase, tx);
      return { ok: true as const };
    });
    if (!result.ok) redirect(`/admin/business/chefs/${id}?err=request-gone`);

    // Outcome email to the chef (direct — chefs have no recipientsFor seam).
    if (chef!.email) {
      const fieldLabel = chefChangeFieldLabel(req.field);
      const send = await sendEmail({
        to: chef!.email,
        subject:
          decision === "approved"
            ? `Wijziging doorgevoerd: ${fieldLabel}`
            : `Wijzigingsverzoek niet doorgevoerd: ${fieldLabel}`,
        react: (
          <div>
            <h1>
              {decision === "approved"
                ? "Je wijziging is doorgevoerd"
                : "Je wijzigingsverzoek is niet doorgevoerd"}
            </h1>
            <p>
              <strong>Onderdeel:</strong> {fieldLabel}
              {decision === "approved" ? (
                <>
                  <br />
                  <strong>Nieuwe waarde:</strong>{" "}
                  {formatChefChangeValue(req.field, req.proposedValue)}
                </>
              ) : null}
              {decisionNotes ? (
                <>
                  <br />
                  <strong>Toelichting van Chef &amp; Serve:</strong> {decisionNotes}
                </>
              ) : null}
            </p>
            <p>Vragen? Mail of bel het kantoor — we helpen je graag.</p>
          </div>
        ),
      });
      if (send.ok) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: chef!.email,
          template: "ChefProfileChangeOutcomeInline",
          eventKey: "profile_change_request",
          entityType: "profile_change_requests",
          entityId: requestId,
          userId: chef!.userId ?? undefined,
        });
      }
    }

    redirect(`/admin/business/chefs/${id}?ok=change-${decision}`);
  }

  async function approveProfileChange(formData: FormData) {
    "use server";
    await decideProfileChange(formData, "approved");
  }
  async function rejectProfileChange(formData: FormData) {
    "use server";
    await decideProfileChange(formData, "rejected");
  }

  /* ---------- view --------------------------------------------- */
  return (
    <DetailShell
      className="mx-auto max-w-3xl"
      backHref="/admin/business/chefs"
      backLabel="Alle chefs"
      eyebrow="Chef-profiel"
      title={chef.fullName}
      actions={<StatusBadge status={chef.status} />}
    >
      {/* Subtitle preserved: DetailShell has no subtitle slot, so the original
          "Toegevoegd … via inbox" line is rendered here, just under the header. */}
      <p className="mt-1 text-xs text-ink-500">
        Toegevoegd{" "}
        {new Date(chef.joinedAt).toLocaleDateString("nl-NL", {
          dateStyle: "long",
        })}
        {sourceSubmission && (
          <>
            {" · "}
            <Link
              href={`/admin/business/inbox/chef/${sourceSubmission.id}`}
              className="text-burgundy underline-offset-4 hover:underline"
            >
              via inbox
            </Link>
          </>
        )}
      </p>

      {/* PR-KLANT-5: rating summary (internal — admin only) */}
      <RatingSummary rating={rating} />

      {/* PR-CHEF-4 admin review: chef-submitted change requests */}
      <ChangeRequests
        pendingChanges={pendingChanges}
        decidedChanges={decidedChanges}
        approveProfileChange={approveProfileChange}
        rejectProfileChange={rejectProfileChange}
      />

      <BasicsForm
        chef={chef}
        updateBasics={updateBasics}
        VAKNIVEAU_OPTIONS={VAKNIVEAU_OPTIONS}
        SEGMENT_OPTIONS={SEGMENT_OPTIONS}
      />

      {/* Portal access */}
      <PortalAccess
        chef={chef}
        portalUser={portalUser}
        doInviteToPortal={doInviteToPortal}
        doActivatePortal={doActivatePortal}
        doDisablePortal={doDisablePortal}
      />

      {/* Documents */}
      <DocumentsSection
        chef={chef}
        documents={documents}
        DOC_TYPE_LABELS={DOC_TYPE_LABELS}
        deleteDocument={deleteDocument}
        uploadRequest={uploadRequest}
        r2Ready={r2Ready}
      />

      {/* PR-1.6: Chef 360 — track record at a glance */}
      <Chef360
        chef={chef}
        onboarding={onboarding}
        hasIdFront={hasIdFront}
        hasIdBack={hasIdBack}
        completeness={completeness}
        dataRequests={dataRequests}
        workSummary={workSummary}
        feedback={feedback}
        recentShifts={recentShifts}
        reliability={reliability}
        trends={trends}
        doRequestData={doRequestData}
      />
    </DetailShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "onboarding"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    onboarding: "Onboarding",
    active: "Actief",
    paused: "Gepauzeerd",
    inactive: "Inactief",
    archived: "Gearchiveerd",
  };
  return (
    <span
      className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
