import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefSubmissions,
  chefs,
  profileChangeRequests,
  users,
} from "@/lib/db/schema";
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
import { computeChefInzetbaarheid } from "@/lib/domain/chef-inzetbaarheid";
import { getChefReliability } from "@/lib/chef-events";
import {
  createProfileDataRequest,
  listProfileDataRequests,
} from "@/lib/domain/profile-data-requests";
import { decideChefProfileChange } from "@/lib/domain/chef-profile-changes";
import { getChefAverageForAdmin } from "@/lib/domain/ratings";
import { requirePermission } from "@/lib/permissions";
import { r2IsConfigured } from "@/lib/r2";
import { DetailShell } from "@/components/ui/DetailShell";

import { RatingSummary } from "./_components/RatingSummary";
import { ChangeRequests } from "./_components/ChangeRequests";
import { BasicsForm } from "./_components/BasicsForm";
import { PortalAccess } from "./_components/PortalAccess";
import { DocumentsSection } from "./_components/DocumentsSection";
import { Chef360 } from "./_components/Chef360";
import { InzetbaarheidCard } from "./_components/InzetbaarheidCard";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ portal?: string; reason?: string }>;
}) {
  await requirePermission("chefs", "write");
  const { id } = await params;
  const sp = await searchParams;

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

  // Inzetbaarheid (deployability) verdict — the top-of-page "kan deze chef de vloer
  // op?" answer. Pure re-presentation of the onboarding/completeness/reliability
  // signals already computed above (no extra query).
  const inzetbaarheid = computeChefInzetbaarheid({
    status: chef.status,
    onboardingMissingCritical: onboarding.missingCritical,
    idExpired: onboarding.idExpired,
    idExpiringSoon: onboarding.idExpiringSoon,
    profileScore: completeness.score,
    noShowCount: workSummary.noShowCount,
    churnLevel: trends.churn.level,
  });
  const portalStatus: "none" | "invited" | "active" | "other" = !portalUser
    ? "none"
    : portalUser.status === "active"
      ? "active"
      : portalUser.status === "invited"
        ? "invited"
        : "other";

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
      redirect(`/admin/business/chefs/${id}?portal=invite_failed&reason=${encodeURIComponent(result.error)}`);
    }
    // Account created — but NO email yet (two-step by design). Guide to the activate step.
    redirect(`/admin/business/chefs/${id}?portal=invited`);
  }

  async function doActivatePortal() {
    "use server";
    const session = await requirePermission("chefs", "write");
    if (!chef!.userId) throw new Error("Chef has no portal user yet");
    const res = await activatePortalUser(chef!.userId, session.user.id);
    if (!res.ok) {
      redirect(`/admin/business/chefs/${id}?portal=activate_failed&reason=${encodeURIComponent(res.error)}`);
    }
    if (res.emailSent) {
      redirect(`/admin/business/chefs/${id}?portal=activated_sent`);
    }
    redirect(
      `/admin/business/chefs/${id}?portal=activated_no_email&reason=${encodeURIComponent(res.emailError ?? "onbekend")}`,
    );
  }

  async function doDisablePortal() {
    "use server";
    const session = await requirePermission("chefs", "write");
    if (!chef!.userId) return;
    await disablePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  // One-click: create the portal account AND activate it (+ welcome mail) in a single step,
  // so there's no "invited but can't log in" limbo. Chains the two tested helpers.
  async function doInviteAndActivate() {
    "use server";
    const session = await requirePermission("chefs", "write");
    const invited = await inviteChefToPortal(id, session.user.id);
    if (!invited.ok) {
      redirect(`/admin/business/chefs/${id}?portal=invite_failed&reason=${encodeURIComponent(invited.error)}`);
    }
    const res = await activatePortalUser(invited.userId, session.user.id);
    if (!res.ok) {
      redirect(`/admin/business/chefs/${id}?portal=activate_failed&reason=${encodeURIComponent(res.error)}`);
    }
    redirect(
      res.emailSent
        ? `/admin/business/chefs/${id}?portal=activated_sent`
        : `/admin/business/chefs/${id}?portal=activated_no_email&reason=${encodeURIComponent(res.emailError ?? "onbekend")}`,
    );
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

    const res = await decideChefProfileChange({
      requestId,
      decidedBy: session.user.id,
      decision,
      decisionNotes,
      expectChefId: id,
    });
    if (!res.ok) {
      redirect(`/admin/business/chefs/${id}?err=${res.reason}`);
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

      {sp.portal && (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            sp.portal === "activated_sent"
              ? "border-green-300 bg-green-50 text-green-900"
              : sp.portal === "invited"
                ? "border-blue-300 bg-blue-50 text-blue-900"
                : sp.portal === "activated_no_email"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {sp.portal === "invited" &&
            "Portaal-account aangemaakt. Klik nu hieronder op 'Activeer (stuur welkom-mail)' om de chef toegang te geven en de welkomstmail te versturen."}
          {sp.portal === "activated_sent" && "Geactiveerd - de welkomstmail is verstuurd."}
          {sp.portal === "activated_no_email" &&
            `Geactiveerd, maar de welkomstmail kon NIET verzonden worden${sp.reason ? `: ${sp.reason}` : ""}. Controleer het e-mailadres en de Resend-domeinverificatie (RESEND_FROM_EMAIL moet een geverifieerd domein zijn).`}
          {sp.portal === "invite_failed" && `Uitnodigen mislukt${sp.reason ? `: ${sp.reason}` : ""}.`}
          {sp.portal === "activate_failed" && `Activeren mislukt${sp.reason ? `: ${sp.reason}` : ""}.`}
        </div>
      )}

      {/* Inzetbaarheid — top-of-page "kan deze chef de vloer op?" verdict + the
          consolidated actions (portal invite/activate, mail, bel, spring-naar-bewerken).
          Answers the operator's #1 question before any editing chrome. */}
      <InzetbaarheidCard
        verdict={inzetbaarheid}
        rating={workSummary.averageRating}
        ratingCount={workSummary.ratingCount}
        noShowCount={workSummary.noShowCount}
        cancelledCount={workSummary.cancelledCount}
        lastWorkedAt={workSummary.lastWorkedAt}
        upcomingShifts={workSummary.upcomingShifts}
        email={chef.email}
        phone={chef.phone}
        portalStatus={portalStatus}
        doInviteAndActivate={doInviteAndActivate}
        doActivatePortal={doActivatePortal}
      />

      {/* PR-1.6: Chef 360 — full track record, moved directly under the verdict so
          opening a chef shows WHO they are first, before the editing chrome. */}
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

      {/* PR-KLANT-5: rating breakdown (internal — admin only) */}
      <RatingSummary rating={rating} />

      {/* Documents */}
      <DocumentsSection
        chef={chef}
        documents={documents}
        DOC_TYPE_LABELS={DOC_TYPE_LABELS}
        deleteDocument={deleteDocument}
        uploadRequest={uploadRequest}
        r2Ready={r2Ready}
      />

      {/* Bewerken — pushed below the overview; anchor target for the verdict card's
          "Gegevens bewerken ↓" link. */}
      <div id="bewerken" className="scroll-mt-6">
        <BasicsForm
          chef={chef}
          updateBasics={updateBasics}
          VAKNIVEAU_OPTIONS={VAKNIVEAU_OPTIONS}
          SEGMENT_OPTIONS={SEGMENT_OPTIONS}
        />
      </div>

      {/* PR-CHEF-4 admin review: chef-submitted change requests */}
      <ChangeRequests
        pendingChanges={pendingChanges}
        decidedChanges={decidedChanges}
        approveProfileChange={approveProfileChange}
        rejectProfileChange={rejectProfileChange}
      />

      {/* Portal access — full controls (the primary invite/activate action is also
          surfaced in the verdict card above). */}
      <PortalAccess
        chef={chef}
        portalUser={portalUser}
        doInviteToPortal={doInviteToPortal}
        doInviteAndActivate={doInviteAndActivate}
        doActivatePortal={doActivatePortal}
        doDisablePortal={doDisablePortal}
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
