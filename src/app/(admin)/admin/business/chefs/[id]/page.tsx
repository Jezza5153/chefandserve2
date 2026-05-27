import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { auditLog, chefSubmissions, chefs, users } from "@/lib/db/schema";
import {
  activatePortalUser,
  disablePortalUser,
  inviteChefToPortal,
} from "@/lib/domain/portal-invites";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Chef" };

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
  await requireRole("owner");
  const { id } = await params;

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, id) });
  if (!chef) notFound();

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

  /* ---------- server actions ----------------------------------- */
  async function doInviteToPortal() {
    "use server";
    const session = await requireRole("owner");
    const result = await inviteChefToPortal(id, session.user.id);
    if (!result.ok) {
      throw new Error(result.error);
    }
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doActivatePortal() {
    "use server";
    const session = await requireRole("owner");
    if (!chef!.userId) throw new Error("Chef has no portal user yet");
    await activatePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  async function doDisablePortal() {
    "use server";
    const session = await requireRole("owner");
    if (!chef!.userId) return;
    await disablePortalUser(chef!.userId, session.user.id);
    redirect(`/admin/business/chefs/${id}`);
  }

  /* ---------- server actions ----------------------------------- */
  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
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

    await db.insert(auditLog).values({
      userId: session.user.id,
      action: "chefs.update",
      resource: "chefs",
      resourceId: id,
    });

    redirect(`/admin/business/chefs/${id}`);
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

      <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Binnenkort op deze pagina</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>· Beschikbaarheidskalender (Phase 4)</li>
          <li>· Vakniveau + segmenten + specialties tags</li>
          <li>· Tarief-band (€/uur min/max)</li>
          <li>· Documenten (CV, foto, certificaten — Phase 2 polish met R2)</li>
          <li>· Plaatsings-geschiedenis (Phase 3)</li>
          <li>· Ratings van klanten (Phase 6)</li>
        </ul>
      </div>
    </div>
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
