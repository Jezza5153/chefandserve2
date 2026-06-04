/**
 * /chef/profile — PR-CHEF-4 rebuild.
 *
 * Two zones:
 *
 *   DIRECT EDITABLE (chef writes immediately):
 *     phone, city, languages, specialties, segments (free-text+multi via simple inputs)
 *
 *   REQUEST CHANGE (chef proposes, Maarten approves):
 *     fullName, email, vakniveau, hourlyRateMinCents, hourlyRateMaxCents
 *     → INSERT profile_change_requests
 *
 * Server actions:
 *   saveProfile(formData)         — direct edit, audit-logged
 *   requestChange(formData)       — INSERT profile_change_requests + admin email
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { ProfileForm } from "./ProfileForm";
import { RequestChangeFormSection } from "./RequestChangeFormSection";
import { db } from "@/lib/db/client";
import {
  chefDocuments,
  chefs,
  profileChangeRequests,
} from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { getChefSummaryForChef } from "@/lib/domain/ratings";
import { formatChefRole } from "@/lib/labels";
import { sendEmail } from "@/lib/email";
import {
  createNotificationsFanOut,
  enqueueIntegrationEvent,
} from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const metadata = { title: "Mijn profiel" };
export const dynamic = "force-dynamic";

type Segment =
  | "casual"
  | "fine_dining"
  | "hotel"
  | "banqueting"
  | "catering"
  | "event"
  | "corporate"
  | "michelin";

async function saveProfile(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) return;

  const phone = String(formData.get("phone") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const languages = String(formData.get("languages") ?? "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  const specialties = String(formData.get("specialties") ?? "").trim() || null;
  const segments = formData.getAll("segments").map((s) => String(s)) as Segment[];

  const before = {
    phone: chef.phone,
    city: chef.city,
    languages: chef.languages,
    specialties: chef.specialties,
    segments: chef.segments,
  };

  await db
    .update(chefs)
    .set({
      phone,
      city,
      languages: languages.length > 0 ? languages : null,
      specialties,
      segments: segments.length > 0 ? segments : null,
      updatedAt: new Date(),
    })
    .where(eq(chefs.id, chef.id));

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "chef.profile_updated",
    resource: "chefs",
    resourceId: chef.id,
    before,
    after: { phone, city, languages, specialties, segments },
  });

  // Outbox event — future Payingit/accounting can subscribe.
  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "chef.updated",
    entityType: "chef",
    entityId: chef.id,
    payload: { phone, city, languages, specialties, segments },
    idempotencyKey: `chef.updated:${chef.id}:${Date.now()}`,
  });

  redirect("/chef/profile?ok=saved");
}

async function requestChange(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) return;

  const field = String(formData.get("field") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!field || reason.length < 5) {
    redirect("/chef/profile?error=request-incomplete");
  }

  let currentValue: unknown = null;
  let proposedValue: unknown = null;
  switch (field) {
    case "hourlyRate": {
      currentValue = {
        min: chef.hourlyRateMinCents,
        max: chef.hourlyRateMaxCents,
      };
      const min = Number(formData.get("hourlyRateMin"));
      const max = Number(formData.get("hourlyRateMax"));
      if (!isFinite(min) || !isFinite(max) || min < 0 || max < min) {
        redirect("/chef/profile?error=bad-rate");
      }
      proposedValue = {
        min: Math.round(min * 100),
        max: Math.round(max * 100),
      };
      break;
    }
    case "fullName":
      currentValue = chef.fullName;
      proposedValue = String(formData.get("proposed") ?? "").trim();
      if (!proposedValue) redirect("/chef/profile?error=request-incomplete");
      break;
    case "email":
      currentValue = chef.email;
      proposedValue = String(formData.get("proposed") ?? "").trim().toLowerCase();
      if (!proposedValue) redirect("/chef/profile?error=request-incomplete");
      break;
    case "vakniveau":
      currentValue = chef.vakniveau;
      proposedValue = String(formData.get("proposed") ?? "");
      if (!proposedValue) redirect("/chef/profile?error=request-incomplete");
      break;
    default:
      redirect("/chef/profile?error=request-incomplete");
  }

  const [req] = await db
    .insert(profileChangeRequests)
    .values({
      chefId: chef.id,
      field,
      currentValue: currentValue as never,
      proposedValue: proposedValue as never,
      reason,
    })
    .returning({ id: profileChangeRequests.id });

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "chef.profile_change_requested",
    resource: "profile_change_requests",
    resourceId: req.id,
    after: { field, reason },
  });

  // Notify admins (routable via existing 'chef_submission_received' fallback)
  // We'll piggyback on an existing route; a dedicated event 'profile_change_request'
  // is added later in notification routes admin UI.
  const adminEmails = await recipientsFor("chef_submission_received");
  if (adminEmails.length > 0) {
    await sendEmail({
      to: adminEmails,
      subject: `Wijzigingsverzoek van ${chef.fullName}: ${field}`,
      // Plain text via a tiny inline template — no React Email needed for V1
      // (we'll add a proper template in PR-CHEF-5 polish if it gets noisy).
      react: (
        <div>
          <h1>{`Wijzigingsverzoek van ${chef.fullName}`}</h1>
          <p>
            <strong>Veld:</strong> {field}
            <br />
            <strong>Huidige waarde:</strong> {JSON.stringify(currentValue)}
            <br />
            <strong>Voorgesteld:</strong> {JSON.stringify(proposedValue)}
            <br />
            <strong>Toelichting:</strong> {reason}
          </p>
          <p>
            Open in admin:{" "}
            <a href={`${process.env.NEXT_PUBLIC_APP_URL}/admin/business/chefs/${chef.id}`}>
              chef-detail
            </a>
            .
          </p>
        </div>
      ),
    });
  }

  // Best-effort fan-out notification to all admin users
  // (we'd ideally resolve user ids from email here; for V1 we skip and
  // rely on the email send above).
  void createNotificationsFanOut;

  redirect("/chef/profile?ok=requested");
}

export default async function ChefProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requireAuth("/chef/profile");
  const sp = await searchParams;

  const [chef] = await db
    .select()
    .from(chefs)
    .where(eq(chefs.userId, session.user.id))
    .limit(1);

  if (!chef) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">
          Je account is wel actief, maar er is nog geen chef-profiel aan je
          gekoppeld. Stuur een berichtje naar Maarten of Gina.
        </p>
      </div>
    );
  }

  const [photo] = await db
    .select({ id: chefDocuments.id })
    .from(chefDocuments)
    .where(
      and(
        eq(chefDocuments.chefId, chef.id),
        eq(chefDocuments.type, "photo"),
        isNull(chefDocuments.deletedAt),
      ),
    )
    .orderBy(desc(chefDocuments.createdAt))
    .limit(1);

  // Pending change requests
  const pending = await db
    .select()
    .from(profileChangeRequests)
    .where(
      and(
        eq(profileChangeRequests.chefId, chef.id),
        eq(profileChangeRequests.status, "pending"),
      ),
    )
    .orderBy(desc(profileChangeRequests.createdAt));

  // PR-KLANT-5: own rating summary (average only at N>=5, no comments).
  const ratingSummary = await getChefSummaryForChef(chef.id);

  const flashOk =
    sp.ok === "saved"
      ? "✓ Profiel opgeslagen."
      : sp.ok === "requested"
        ? "✓ Verzoek verstuurd naar Chef & Serve."
        : null;
  const flashErr =
    sp.error === "request-incomplete"
      ? "Vul alle velden in (toelichting min 5 tekens)."
      : sp.error === "bad-rate"
        ? "Tarief klopt niet — max moet groter of gelijk aan min zijn."
        : null;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn profiel
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {chef.fullName}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Wat wij van jou hebben staan. Sommige velden kun je direct aanpassen —
        andere moeten via Chef &amp; Serve om te voorkomen dat tarieven per
        ongeluk wijzigen.
      </p>

      {flashOk ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {flashErr}
        </p>
      ) : null}

      {/* Mijn gegevens & werkprofiel — read-only snapshot */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Mijn gegevens &amp; werkprofiel
        </h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-[120px_1fr]">
        <div className="aspect-square overflow-hidden rounded-lg border border-ink-200 bg-bg-gray">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/chef-photo/${photo.id}`}
              alt={chef.fullName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center font-serif text-3xl text-ink-200">
              {chef.fullName
                .split(" ")
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          )}
        </div>
        <div className="text-sm">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            E-mail
          </p>
          <p className="text-ink-900">{chef.email}</p>
          <p className="mt-3 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Vakniveau · jaren ervaring
          </p>
          <p className="text-ink-900">
            {formatChefRole(chef.vakniveau)} · {chef.yearsExperience ?? "—"} jaar
          </p>
          <p className="mt-3 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Huidig tarief
          </p>
          <p className="text-ink-900">
            €
            {chef.hourlyRateMinCents
              ? (chef.hourlyRateMinCents / 100).toFixed(0)
              : "—"}{" "}
            — €
            {chef.hourlyRateMaxCents
              ? (chef.hourlyRateMaxCents / 100).toFixed(0)
              : "—"}{" "}
            per uur
          </p>

          {ratingSummary.hasFeedback ? (
            <>
              <p className="mt-3 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                Feedback van klanten
              </p>
              <p className="text-ink-900">
                {ratingSummary.ratingCount}{" "}
                {ratingSummary.ratingCount === 1 ? "klant heeft" : "klanten hebben"}{" "}
                feedback gegeven
                {ratingSummary.averageRating != null ? (
                  <> · gemiddeld {ratingSummary.averageRating.toFixed(1)} ★</>
                ) : (
                  <span className="text-ink-500">
                    {" "}
                    · gemiddelde vanaf 5 feedbacks
                  </span>
                )}
              </p>
            </>
          ) : null}
        </div>
      </div>
      </section>

      {pending.length > 0 ? (
        <section className="mt-10 rounded-lg border border-burgundy/30 bg-burgundy/5 p-5">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            In behandeling
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-ink-900">{labelForField(p.field)}</p>
                  <p className="text-xs text-ink-500">{p.reason}</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                  In behandeling
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Editable section */}
      <ProfileForm
        chef={{
          phone: chef.phone,
          city: chef.city,
          languages: chef.languages,
          specialties: chef.specialties,
          segments: (chef.segments ?? []) as readonly string[],
        }}
        saveAction={saveProfile}
      />

      {/* Request-change section */}
      <RequestChangeFormSection
        chef={{
          fullName: chef.fullName,
          email: chef.email,
          vakniveau: chef.vakniveau,
          hourlyRateMinCents: chef.hourlyRateMinCents,
          hourlyRateMaxCents: chef.hourlyRateMaxCents,
        }}
        requestAction={requestChange}
      />

      {/* Documents — PR-CHEF-12 */}
      <DocumentsSection chefId={chef.id} />

      {/* PR-CHEF-2a: chefs.notes is INTERNAL admin-only — never shown to the chef
          (staff write candid remarks there). A chef-visible message channel is 2b. */}
    </div>
  );
}

async function DocumentsSection({ chefId }: { chefId: string }) {
  const docs = await db
    .select()
    .from(chefDocuments)
    .where(
      and(
        eq(chefDocuments.chefId, chefId),
        isNull(chefDocuments.deletedAt),
      ),
    )
    .orderBy(desc(chefDocuments.createdAt));

  return (
    <section className="mt-10">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Documenten
      </h2>
      {docs.length === 0 ? (
        <p className="mt-3 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-500">
          Nog geen documenten geüpload. Vraag het kantoor om je documenten
          toe te voegen.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-white px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <a
                  href={`/api/chef-document/${d.id}`}
                  className="text-ink-900 hover:text-burgundy hover:underline"
                >
                  {d.filename}
                </a>
                <p className="mt-0.5 text-xs text-ink-500">
                  {labelForDocType(d.type)} ·{" "}
                  {new Date(d.createdAt).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {d.expiresAt
                    ? ` · verloopt ${new Date(d.expiresAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}`
                    : ""}
                </p>
              </div>
              <div className="shrink-0 space-x-2">
                <DocVisibilityChip clientVisible={d.clientVisible} />
                <DocStatusChip status={d.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function labelForDocType(t: string): string {
  return (
    {
      cv: "CV",
      photo: "Foto",
      certificate: "Certificaat",
      id_document: "ID-bewijs",
      other: "Document",
    } as Record<string, string>
  )[t] ?? t;
}

function DocVisibilityChip({ clientVisible }: { clientVisible: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider ${
        clientVisible
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-700"
      }`}
      title={
        clientVisible
          ? "Klanten met een bevestigde shift mogen dit document zien"
          : "Alleen Chef & Serve ziet dit document"
      }
    >
      {clientVisible ? "Klant mag zien" : "Alleen intern"}
    </span>
  );
}

function DocStatusChip({ status }: { status: string }) {
  const labels: Record<string, string> = {
    uploaded: "Geüpload",
    needs_review: "Wacht op controle",
    verified: "✓ Geverifieerd",
    expired: "⚠ Verlopen",
    rejected: "✗ Afgewezen",
  };
  const tone: Record<string, string> = {
    uploaded: "bg-bg-gray text-ink-700",
    needs_review: "bg-amber-100 text-amber-800",
    verified: "bg-emerald-100 text-emerald-700",
    expired: "bg-burgundy/10 text-burgundy",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider ${tone[status] ?? "bg-bg-gray text-ink-700"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function labelForField(field: string): string {
  return (
    {
      fullName: "Naam",
      email: "E-mailadres",
      vakniveau: "Vakniveau",
      hourlyRate: "Uurtarief",
    } as Record<string, string>
  )[field] ?? field;
}
