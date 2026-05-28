import { asc, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { clients, shifts } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Nieuwe shift" };

const ROLE_OPTIONS = [
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

export default async function NewShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  await requireRole("owner");
  const params = await searchParams;

  const clientList = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
    })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(asc(clients.companyName));

  async function createShift(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const clientId = String(formData.get("clientId") ?? "").trim();
    const startsAtStr = String(formData.get("startsAt") ?? "").trim();
    const endsAtStr = String(formData.get("endsAt") ?? "").trim();
    const roleNeeded = String(formData.get("roleNeeded") ?? "") as
      | (typeof ROLE_OPTIONS)[number];
    const segment = (String(formData.get("segment") ?? "") || null) as
      | (typeof SEGMENT_OPTIONS)[number]
      | null;
    const headcount = Number(formData.get("headcount") ?? 1);
    const city = String(formData.get("city") ?? "").trim() || null;
    const location = String(formData.get("location") ?? "").trim() || null;
    const clientRateEur = Number(formData.get("clientRateEur") ?? 0);
    const chefRateEur = Number(formData.get("chefRateEur") ?? 0);
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!clientId || !startsAtStr || !endsAtStr || !roleNeeded) {
      throw new Error("Verplichte velden ontbreken");
    }

    const startsAt = new Date(startsAtStr);
    const endsAt = new Date(endsAtStr);
    if (endsAt <= startsAt) {
      throw new Error("Eindtijd moet na starttijd liggen");
    }

    const [shift] = await db
      .insert(shifts)
      .values({
        clientId,
        startsAt,
        endsAt,
        roleNeeded,
        segment,
        headcount: Math.max(1, headcount),
        city,
        location,
        clientRateCents: clientRateEur > 0 ? Math.round(clientRateEur * 100) : null,
        chefRateCents: chefRateEur > 0 ? Math.round(chefRateEur * 100) : null,
        notes,
        status: "open",
        createdBy: session.user.id,
      })
      .returning({ id: shifts.id });

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "shifts.create",
      resource: "shifts",
      resourceId: shift.id,
      after: { clientId, roleNeeded, headcount },
    });

    redirect(`/admin/business/shifts/${shift.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/business/shifts"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Shifts
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Nieuwe shift
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Plan een shift
      </h1>
      <p className="mt-3 text-sm text-ink-700">
        Vul de shift-details in. Na opslaan kun je chefs matchen via de
        "Match chefs" knop op de detail-pagina.
      </p>

      {clientList.length === 0 && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Er zijn nog geen klanten. <Link href="/admin/business/clients" className="underline">Voeg een klant toe</Link> via de inbox of handmatig.
        </div>
      )}

      <form
        action={createShift}
        className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <Field
            label="Klant"
            name="clientId"
            as="select"
            required
            defaultValue={params.clientId ?? ""}
            options={[
              { value: "", label: "— Kies klant —" },
              ...clientList.map((c) => ({ value: c.id, label: c.companyName })),
            ]}
          />
        </div>
        <Field
          label="Starttijd"
          name="startsAt"
          type="datetime-local"
          required
        />
        <Field
          label="Eindtijd"
          name="endsAt"
          type="datetime-local"
          required
        />
        <Field
          label="Rol nodig"
          name="roleNeeded"
          as="select"
          required
          options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
        />
        <Field
          label="Segment"
          name="segment"
          as="select"
          options={[
            { value: "", label: "— Geen —" },
            ...SEGMENT_OPTIONS.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Field
          label="Aantal personen"
          name="headcount"
          type="number"
          defaultValue="1"
          required
        />
        <Field label="Stad" name="city" />
        <Field
          label="Locatie / adres"
          name="location"
        />
        <Field
          label="Tarief klant (€/uur)"
          name="clientRateEur"
          type="number"
        />
        <Field
          label="Tarief chef (€/uur)"
          name="chefRateEur"
          type="number"
        />
        <div className="md:col-span-2">
          <Field
            label="Notities (alleen Maarten ziet dit)"
            name="notes"
            as="textarea"
          />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Shift opslaan
          </button>
        </div>
      </form>
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
          rows={3}
          className={baseClass}
        />
      ) : as === "select" ? (
        <select name={name} defaultValue={defaultValue} required={required} className={baseClass}>
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
