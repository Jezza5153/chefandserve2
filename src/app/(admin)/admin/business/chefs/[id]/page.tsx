import { and, desc, eq } from "drizzle-orm";
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
import { clientTypeLabel } from "@/lib/domain/client-taxonomy";
import { getOnboardingReadiness, getProfileCompleteness } from "@/lib/domain/profile-completeness";
import {
  createProfileDataRequest,
  listProfileDataRequests,
} from "@/lib/domain/profile-data-requests";
import { getChefAverageForAdmin } from "@/lib/domain/ratings";
import { RATING_TAG_LABELS, type RatingTag } from "@/lib/rating-tags";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { requireAnyRole } from "@/lib/permissions";
import { r2IsConfigured } from "@/lib/r2";

import { DocumentUploader } from "./_components/DocumentUploader";

export const metadata = { title: "Chef" };

const DOC_TYPE_LABELS: Record<string, string> = {
  cv: "CV",
  photo: "Foto",
  certificate: "Certificaat",
  id_document: "ID-bewijs",
  other: "Overig",
};

const TRANSPORT_LABELS: Record<string, string> = {
  car: "Auto", motorbike: "Motor", ebike: "E-bike", none: "Geen (OV)",
};
const PREF_LABELS: Record<string, string> = {
  bbq: "BBQ", breakfast: "Ontbijt", banqueting: "Banqueting", beachclub: "Beachclub",
  early_shifts: "Vroege diensten", hotels: "Hotels", restaurants: "Restaurants",
  michelin: "Michelin", flexible: "Flexibel",
};
const REQ_STATUS_LABELS: Record<string, string> = {
  draft: "concept", sent: "verzonden", completed: "ingevuld", expired: "verlopen", failed: "mislukt",
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
  await requireAnyRole(["owner", "planner"]);
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
  const [workSummary, feedback, recentShifts] = await Promise.all([
    getChefWorkSummary(id),
    getChefFeedbackSummary(id),
    getChefRecentShifts(id, 8),
  ]);

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
    const session = await requireAnyRole(["owner", "planner"]);
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
    const session = await requireAnyRole(["owner", "planner"]);
    return requestChefDocumentUpload({
      ...args,
      uploadedBy: session.user.id,
    });
  }

  async function deleteDocument(formData: FormData) {
    "use server";
    const session = await requireAnyRole(["owner", "planner"]);
    const documentId = String(formData.get("documentId") ?? "");
    if (!documentId) return;
    await softDeleteChefDocument(documentId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- server actions ----------------------------------- */
  async function doInviteToPortal() {
    "use server";
    const session = await requireAnyRole(["owner", "planner"]);
    const result = await inviteChefToPortal(id, session.user.id);
    if (!result.ok) {
      throw new Error(result.error);
    }
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doActivatePortal() {
    "use server";
    const session = await requireAnyRole(["owner", "planner"]);
    if (!chef!.userId) throw new Error("Chef has no portal user yet");
    await activatePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doDisablePortal() {
    "use server";
    const session = await requireAnyRole(["owner", "planner"]);
    if (!chef!.userId) return;
    await disablePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- server actions ----------------------------------- */
  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requireAnyRole(["owner", "planner"]);
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
    const session = await requireAnyRole(["owner", "planner"]);
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

    // Apply the proposed value on approval.
    if (decision === "approved") {
      const pv = req.proposedValue as unknown;
      if (req.field === "hourlyRate" && pv && typeof pv === "object") {
        const { min, max } = pv as { min?: number; max?: number };
        await db
          .update(chefs)
          .set({
            hourlyRateMinCents: typeof min === "number" ? min : null,
            hourlyRateMaxCents: typeof max === "number" ? max : null,
            updatedAt: new Date(),
          })
          .where(eq(chefs.id, id));
      } else if (req.field === "fullName") {
        await db
          .update(chefs)
          .set({ fullName: String(pv), updatedAt: new Date() })
          .where(eq(chefs.id, id));
      } else if (req.field === "email") {
        await db
          .update(chefs)
          .set({ email: String(pv).toLowerCase(), updatedAt: new Date() })
          .where(eq(chefs.id, id));
      } else if (req.field === "vakniveau") {
        await db
          .update(chefs)
          .set({ vakniveau: String(pv) as never, updatedAt: new Date() })
          .where(eq(chefs.id, id));
      }
    }

    // Atomic transition — only flip a still-pending request.
    const updated = await db
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
    if (updated.length === 0) redirect(`/admin/business/chefs/${id}?err=request-gone`);

    await recordAuditFromRequest({
      userId: session.user.id,
      action:
        decision === "approved"
          ? "chef.profile_change_approved"
          : "chef.profile_change_rejected",
      resource: "profile_change_requests",
      resourceId: requestId,
      after: { field: req.field, decision, decisionNotes },
    });

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
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/business/chefs"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Alle chefs
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Chef-profiel
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {chef.fullName}
          </h1>
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
        </div>
        <StatusBadge status={chef.status} />
      </div>

      {/* PR-KLANT-5: rating summary (internal — admin only) */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Klant-feedback (intern)
        </h2>
        {rating.ratingCount === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nog geen feedback ontvangen.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-900">
              <span className="font-serif text-2xl">
                {rating.averageRating?.toFixed(2) ?? "—"}
              </span>{" "}
              gemiddeld · {rating.ratingCount} feedback
              {rating.ratingCount === 1 ? "" : "s"}
              {rating.ratingCount < 5 ? (
                <span className="ml-2 text-xs text-ink-500">
                  (chef ziet eigen gemiddelde pas vanaf 5)
                </span>
              ) : null}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {rating.recent.map((r, i) => (
                <li key={i} className="border-b border-ink-100 pb-1.5">
                  <span className="text-burgundy">{"★".repeat(r.stars)}</span>
                  <span className="text-ink-200">{"★".repeat(5 - r.stars)}</span>
                  {r.tags.length > 0 ? (
                    <span className="ml-2 text-xs text-ink-500">
                      {r.tags
                        .map((t) => RATING_TAG_LABELS[t as RatingTag] ?? t)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {r.comment ? (
                    <p className="mt-0.5 text-xs text-ink-700">{r.comment}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* PR-CHEF-4 admin review: chef-submitted change requests */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Wijzigingsverzoeken
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          Velden die de chef via het portaal heeft aangevraagd. Goedkeuren
          voert de wijziging direct door.
        </p>

        {pendingChanges.length === 0 ? (
          <p className="mt-4 rounded bg-bg-gray px-3 py-2 text-xs text-ink-500">
            Geen openstaande verzoeken.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pendingChanges.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-amber-300 bg-amber-50/50 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                    {chefChangeFieldLabel(r.field)}
                  </p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                    Wacht op akkoord
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-sm text-ink-900">
                  <p>
                    <span className="text-ink-500">Huidig:</span>{" "}
                    {formatChefChangeValue(r.field, r.currentValue)}
                  </p>
                  <p>
                    <span className="text-ink-500">Voorgesteld:</span>{" "}
                    <strong>{formatChefChangeValue(r.field, r.proposedValue)}</strong>
                  </p>
                  {r.reason ? (
                    <p className="text-xs text-ink-500">
                      Toelichting chef: {r.reason}
                    </p>
                  ) : null}
                </div>

                <form action={approveProfileChange} className="mt-3">
                  <input type="hidden" name="requestId" value={r.id} />
                  <textarea
                    name="decisionNotes"
                    rows={2}
                    placeholder="Optionele toelichting (gedeeld met de chef)"
                    className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="submit"
                      className="rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
                    >
                      Goedkeuren
                    </button>
                    <button
                      type="submit"
                      formAction={rejectProfileChange}
                      className="rounded-full border border-red-300 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-red-700 hover:bg-red-50"
                    >
                      Afwijzen
                    </button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}

        {decidedChanges.length > 0 ? (
          <details className="mt-5">
            <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500 hover:text-burgundy">
              Geschiedenis ({decidedChanges.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {decidedChanges.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-3 border-b border-ink-200 pb-2"
                >
                  <span className="text-ink-900">
                    {chefChangeFieldLabel(r.field)} →{" "}
                    {formatChefChangeValue(r.field, r.proposedValue)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider ${
                      r.status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-bg-gray text-ink-500"
                    }`}
                  >
                    {r.status === "approved" ? "Doorgevoerd" : "Afgewezen"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <form
        action={updateBasics}
        className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2"
      >
        <Field label="Volledige naam" name="fullName" defaultValue={chef.fullName} required />
        <Field
          label="Status"
          name="status"
          as="select"
          defaultValue={chef.status}
          options={[
            { value: "onboarding", label: "Onboarding" },
            { value: "active", label: "Actief" },
            { value: "paused", label: "Gepauzeerd" },
            { value: "inactive", label: "Inactief" },
            { value: "archived", label: "Gearchiveerd" },
          ]}
        />
        <Field label="E-mail" name="email" type="email" defaultValue={chef.email ?? ""} />
        <Field label="Telefoon" name="phone" defaultValue={chef.phone ?? ""} />
        <Field label="Stad / regio" name="city" defaultValue={chef.city ?? ""} />
        <Field
          label="Jaren ervaring"
          name="yearsExperience"
          type="number"
          defaultValue={chef.yearsExperience?.toString() ?? ""}
        />

        <Field
          label="Vakniveau"
          name="vakniveau"
          as="select"
          defaultValue={chef.vakniveau ?? ""}
          options={[
            { value: "", label: "— Geen —" },
            ...VAKNIVEAU_OPTIONS.map((v) => ({ value: v, label: v })),
          ]}
        />

        <div className="md:col-span-2">
          <label className="block">
            <span className="mb-2 block font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
              Segmenten (waar werkt deze chef?)
            </span>
            <div className="flex flex-wrap gap-2">
              {SEGMENT_OPTIONS.map((s) => {
                const checked = (chef.segments ?? []).includes(s);
                return (
                  <label
                    key={s}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 font-ui text-[11px] uppercase tracking-[0.15em] ${
                      checked
                        ? "border-burgundy bg-burgundy text-white"
                        : "border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="segments"
                      value={s}
                      defaultChecked={checked}
                      className="sr-only"
                    />
                    {s}
                  </label>
                );
              })}
            </div>
          </label>
        </div>

        <div className="md:col-span-2">
          <Field
            label="Specialties (vrije tekst — komma-gescheiden of vrij)"
            name="specialties"
            defaultValue={chef.specialties ?? ""}
          />
        </div>

        <Field
          label="Talen (komma-gescheiden, bv. NL, EN, FR)"
          name="languages"
          defaultValue={(chef.languages ?? []).join(", ")}
        />

        <div />

        <Field
          label="Tarief van (€/uur)"
          name="hourlyRateMinEur"
          type="number"
          defaultValue={
            chef.hourlyRateMinCents
              ? (chef.hourlyRateMinCents / 100).toString()
              : ""
          }
        />
        <Field
          label="Tarief tot (€/uur)"
          name="hourlyRateMaxEur"
          type="number"
          defaultValue={
            chef.hourlyRateMaxCents
              ? (chef.hourlyRateMaxCents / 100).toString()
              : ""
          }
        />

        <div className="md:col-span-2">
          <Field
            label="Notities (Maarten's tribal knowledge)"
            name="notes"
            as="textarea"
            defaultValue={chef.notes ?? ""}
          />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Opslaan
          </button>
        </div>
      </form>

      {/* Portal access */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-ink-900">
              Chef-portaal toegang
            </h2>
            <p className="mt-1 text-sm text-ink-700">
              Geef deze chef toegang tot het portaal om zelf shifts te bekijken
              en te accepteren.
            </p>
          </div>
          {!chef.email ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Vul eerst een e-mailadres in.
            </p>
          ) : !portalUser ? (
            <form action={doInviteToPortal}>
              <button
                type="submit"
                className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
              >
                Nodig uit voor portaal
              </button>
            </form>
          ) : portalUser.status === "invited" ? (
            <form action={doActivatePortal}>
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
              >
                Activeer (stuur welkom-mail)
              </button>
            </form>
          ) : portalUser.status === "active" ? (
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-emerald-700">
                Actief
              </span>
              <form action={doDisablePortal}>
                <button
                  type="submit"
                  className="rounded-full border border-red-300 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                >
                  Toegang intrekken
                </button>
              </form>
            </div>
          ) : (
            <span className="rounded-full bg-bg-gray px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-ink-500">
              {portalUser.status}
            </span>
          )}
        </div>
        {portalUser && (
          <p className="mt-4 text-xs text-ink-500">
            Portal user: {portalUser.email} · status: {portalUser.status}
          </p>
        )}
      </section>

      {/* Documents */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <div className="mb-4">
          <h2 className="font-serif text-lg text-ink-900">Documenten</h2>
          <p className="mt-1 text-sm text-ink-700">
            CV, foto, certificaten, ID-bewijs. Bestanden worden veilig opgeslagen
            in Cloudflare R2 — alleen toegankelijk via tijdelijk-getekende links.
          </p>
        </div>

        {documents.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-bg-gray px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-ink-500">
                    {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                    {doc.sizeBytes &&
                      ` · ${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                    {" · "}
                    {new Date(doc.createdAt).toLocaleDateString("nl-NL")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {doc.downloadUrl && (
                    <a
                      href={doc.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-900 hover:border-burgundy hover:text-burgundy"
                    >
                      Bekijk
                    </a>
                  )}
                  <form action={deleteDocument}>
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-red-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                    >
                      Verwijder
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-ink-500">Nog geen documenten geupload.</p>
        )}

        <DocumentUploader
          chefId={chef.id}
          requestUpload={uploadRequest}
          disabled={!r2Ready}
        />
      </section>

      {/* PR-1.6: Chef 360 — track record at a glance */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Chef 360 — staat van dienst
        </h2>

        {/* PR-KPI: onboarding readiness (payroll/identity data) */}
        <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
              Onboarding &amp; uitbetaalgegevens
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                onboarding.ready
                  ? "bg-emerald-100 text-emerald-700"
                  : onboarding.score >= 60
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {chef.onboardingStatus === "submitted"
                ? "Ingediend"
                : chef.onboardingStatus === "in_progress"
                  ? "Bezig"
                  : "Niet gestart"}{" "}
              · {onboarding.score}%
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {[
              { label: "Naam", ok: !!(chef.firstName && chef.surname) },
              { label: "Geb.datum", ok: !!chef.dateOfBirth },
              { label: "Adres", ok: !!(chef.street && chef.postcode) },
              { label: "BSN", ok: !!chef.bsnEncrypted },
              { label: "IBAN", ok: !!chef.ibanEncrypted },
              { label: "Rekeninghouder", ok: !!chef.bankAccountHolderName },
              { label: "ID-nr", ok: !!chef.idNumberEncrypted },
              { label: "ID-kopie", ok: hasIdFront && hasIdBack },
              { label: "Dienstverband", ok: !!chef.employmentType },
            ].map((c) => (
              <span
                key={c.label}
                className={`rounded-full px-2 py-0.5 ${c.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
              >
                {c.ok ? "✓" : "✗"} {c.label}
              </span>
            ))}
          </div>
          {onboarding.missingCritical.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-amber-700">Mist: {onboarding.missingCritical.join(", ")}</p>
          ) : (
            <p className="mt-1.5 text-[11px] text-emerald-700">✓ Klaar voor inplannen en uitbetaling.</p>
          )}
          {onboarding.idExpired ? (
            <p className="mt-1 text-[11px] text-red-700">⚠ ID-bewijs is verlopen.</p>
          ) : onboarding.idExpiringSoon ? (
            <p className="mt-1 text-[11px] text-amber-700">
              ID-bewijs verloopt binnenkort
              {chef.idExpiresAt ? ` (${new Date(chef.idExpiresAt).toLocaleDateString("nl-NL")})` : ""}.
            </p>
          ) : null}
        </div>

        {/* PR-2: profiel & voorkeuren (uit Jotform) */}
        <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Profiel & voorkeuren</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                completeness.score >= 80
                  ? "bg-emerald-100 text-emerald-700"
                  : completeness.score >= 55
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              profiel {completeness.score}% · {completeness.label}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chef.transportMode && (
              <span className="rounded-full bg-burgundy/5 px-2 py-0.5 text-xs text-burgundy">
                {TRANSPORT_LABELS[chef.transportMode] ?? chef.transportMode}
              </span>
            )}
            {(chef.preferences ?? []).map((p) => (
              <span key={p} className="rounded-full bg-bg-gray px-2 py-0.5 text-xs text-ink-700">
                {PREF_LABELS[p] ?? p}
              </span>
            ))}
            {chef.employmentType && (
              <span className="rounded-full bg-bg-gray px-2 py-0.5 text-xs text-ink-700">
                {chef.employmentType.toUpperCase()}
              </span>
            )}
            {!chef.transportMode && (chef.preferences ?? []).length === 0 && (
              <span className="text-xs text-ink-500">Nog niet uit Jotform overgenomen.</span>
            )}
          </div>
          {(chef.street || chef.postcode) && (
            <p className="mt-2 text-xs text-ink-500">
              {[chef.street, chef.houseNumber].filter(Boolean).join(" ")}
              {chef.postcode ? `, ${chef.postcode}` : ""}
              {chef.city ? ` ${chef.city}` : ""}
            </p>
          )}
          {completeness.missingCritical.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">Mist: {completeness.missingCritical.join(", ")}</p>
          )}
          {(completeness.missingCritical.length > 0 || completeness.score < 80) && (
            <form action={doRequestData} className="mt-3">
              <input
                type="hidden"
                name="fields"
                value={[...completeness.missingCritical, ...completeness.missingNiceToHave].join(",")}
              />
              <button
                type="submit"
                className="rounded-full border border-burgundy/40 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
              >
                Vraag ontbrekende gegevens (e-mail)
              </button>
            </form>
          )}
          {dataRequests.length > 0 && (
            <div className="mt-3 border-t border-ink-100 pt-2">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Verzoeken</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink-700">
                {dataRequests.map((rq) => (
                  <li key={rq.id}>
                    {rq.requestType} · {rq.channel} ·{" "}
                    <span
                      className={
                        rq.status === "completed"
                          ? "text-emerald-700"
                          : rq.status === "failed"
                            ? "text-red-700"
                            : "text-ink-500"
                      }
                    >
                      {REQ_STATUS_LABELS[rq.status] ?? rq.status}
                    </span>
                    {rq.sentAt ? ` · ${fmtNlDate(rq.sentAt)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Snap label="Uren gewerkt" value={`${workSummary.totalHoursWorked} u`} note="goedgekeurd" />
          <Snap
            label="Diensten afgerond"
            value={String(workSummary.completedShifts)}
            note={workSummary.upcomingShifts > 0 ? `${workSummary.upcomingShifts} gepland` : undefined}
          />
          <Snap
            label="Beoordeling"
            value={workSummary.averageRating != null ? `${workSummary.averageRating.toFixed(1)}★` : "—"}
            note={workSummary.ratingCount > 0 ? `${workSummary.ratingCount} reviews` : "geen reviews"}
          />
          <Snap
            label="Laatst gewerkt"
            value={workSummary.lastWorkedAt ? fmtNlDate(workSummary.lastWorkedAt) : "—"}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Rel label="Geaccepteerd" n={workSummary.acceptedCount} />
          <Rel label="Geweigerd" n={workSummary.declinedCount} />
          <Rel label="Geannuleerd" n={workSummary.cancelledCount} tone={workSummary.cancelledCount > 0 ? "amber" : undefined} />
          <Rel label="No-show" n={workSummary.noShowCount} tone={workSummary.noShowCount > 0 ? "red" : undefined} />
        </div>
        <p className="mt-1 text-[10px] text-ink-500">
          Uren uit goedgekeurde urenstaten · betrouwbaarheid uit plaatsingen · beoordelingen uit klantfeedback.
        </p>

        {(workSummary.topClients.length > 0 ||
          workSummary.topSegments.length > 0 ||
          workSummary.topClientTypes.length > 0) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {workSummary.topClients.length > 0 && (
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Meeste ervaring bij</p>
                <ul className="mt-2 space-y-1 text-sm text-ink-900">
                  {workSummary.topClients.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-ink-500">{c.count}×</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {workSummary.topSegments.length > 0 && (
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Sterk in</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {workSummary.topSegments.map((s) => (
                    <span key={s.segment} className="rounded-full bg-burgundy/5 px-2 py-0.5 text-xs text-burgundy">
                      {s.segment} · {s.count}×
                    </span>
                  ))}
                </div>
              </div>
            )}
            {workSummary.topClientTypes.length > 0 && (
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Werkt vooral voor</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {workSummary.topClientTypes.map((t) => (
                    <span key={t.clientType} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                      {clientTypeLabel(t.clientType)} · {t.count}×
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Wat klanten zeggen</p>
          {feedback.topTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-ink-500">Meest genoemd:</span>
              {feedback.topTags.map((t) => (
                <span key={t.tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  {RATING_TAG_LABELS[t.tag as RatingTag] ?? t.tag} ({t.count})
                </span>
              ))}
            </div>
          )}
          {feedback.recent.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">Nog geen beoordelingen.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {feedback.recent.map((f, i) => (
                <li key={i} className="border-t border-ink-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-500">
                      {"★".repeat(f.stars)}
                      <span className="text-ink-200">{"★".repeat(5 - f.stars)}</span>
                    </span>
                    <span className="text-[11px] text-ink-500">{f.clientName ?? "Klant"} · {fmtNlDate(f.createdAt)}</span>
                  </div>
                  {f.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.tags.map((t) => (
                        <span key={t} className="rounded bg-bg-gray px-1.5 py-0.5 text-[10px] text-ink-700">
                          {RATING_TAG_LABELS[t as RatingTag] ?? t}
                        </span>
                      ))}
                    </div>
                  )}
                  {f.comment && <p className="mt-1 text-sm text-ink-700">&ldquo;{f.comment}&rdquo;</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Recente diensten</p>
          {recentShifts.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">Nog geen plaatsingen.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {recentShifts.map((s) => (
                <li key={s.shiftId}>
                  <Link
                    href={`/admin/business/shifts/${s.shiftId}`}
                    className="flex flex-wrap items-center gap-x-2 text-sm hover:text-burgundy"
                  >
                    <span className="text-ink-500">{fmtNlDate(s.startsAt)}</span>
                    <span className="text-ink-900">{s.clientName ?? "Onbekende klant"}</span>
                    <span className="text-ink-500">· {s.roleNeeded}{s.city ? ` · ${s.city}` : ""}</span>
                    <span className="ml-auto rounded-full bg-bg-gray px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                      {s.placementStatus}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function fmtNlDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function Snap({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink-900">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-ink-500">{note}</p>}
    </div>
  );
}

function Rel({ label, n, tone }: { label: string; n: number; tone?: "amber" | "red" }) {
  const cls =
    tone === "red"
      ? "bg-red-100 text-red-700"
      : tone === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-bg-gray text-ink-700";
  return (
    <span className={`rounded-full px-2.5 py-1 font-ui text-[11px] ${cls}`}>
      {label}: <strong>{n}</strong>
    </span>
  );
}

/* ----- helpers ----- */

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  as?: "input" | "textarea" | "select";
  options?: { value: string; label: string }[];
};

function Field({
  label,
  name,
  type = "text",
  defaultValue = "",
  required,
  as = "input",
  options,
}: FieldProps) {
  const baseClass =
    "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
  return (
    <label className="block">
      <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </span>
      {as === "textarea" ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          required={required}
          rows={4}
          className={baseClass}
        />
      ) : as === "select" ? (
        <select name={name} defaultValue={defaultValue} className={baseClass}>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          required={required}
          className={baseClass}
        />
      )}
    </label>
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

/* ----- PR-CHEF-4 admin review helpers ----- */
function chefChangeFieldLabel(field: string): string {
  return (
    {
      fullName: "Naam",
      email: "E-mailadres",
      vakniveau: "Vakniveau",
      hourlyRate: "Uurtarief",
    } as Record<string, string>
  )[field] ?? field;
}

function formatChefChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "hourlyRate" && typeof value === "object") {
    const { min, max } = value as { min?: number; max?: number };
    const fmt = (c?: number) => (typeof c === "number" ? `€${(c / 100).toFixed(0)}` : "—");
    return `${fmt(min)} – ${fmt(max)} per uur`;
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}
