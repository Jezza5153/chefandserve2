import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { auditLog, clientSubmissions, clients } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Klant" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("owner");
  const { id } = await params;

  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) notFound();

  const sourceSubmission = client.sourceSubmissionId
    ? await db.query.clientSubmissions.findFirst({
        where: eq(clientSubmissions.id, client.sourceSubmissionId),
      })
    : null;

  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const companyName = String(formData.get("companyName") ?? "").trim();
    const contactName = String(formData.get("contactName") ?? "").trim() || null;
    const email =
      String(formData.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const address = String(formData.get("address") ?? "").trim() || null;
    const city = String(formData.get("city") ?? "").trim() || null;
    const kvk = String(formData.get("kvk") ?? "").trim() || null;
    const btw = String(formData.get("btw") ?? "").trim() || null;
    const billingEmail =
      String(formData.get("billingEmail") ?? "").trim().toLowerCase() || null;
    const paymentTermsDays = formData.get("paymentTermsDays")
      ? Number(formData.get("paymentTermsDays"))
      : 14;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const status = String(formData.get("status") ?? "prospect") as
      | "prospect"
      | "active"
      | "paused"
      | "archived";

    await db
      .update(clients)
      .set({
        companyName,
        contactName,
        email,
        phone,
        address,
        city,
        kvk,
        btw,
        billingEmail,
        paymentTermsDays,
        notes,
        status,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, id));

    await db.insert(auditLog).values({
      userId: session.user.id,
      action: "clients.update",
      resource: "clients",
      resourceId: id,
    });

    redirect(`/admin/business/clients/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/business/clients"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Alle klanten
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Klant-profiel
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {client.companyName}
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Toegevoegd{" "}
            {new Date(client.joinedAt).toLocaleDateString("nl-NL", {
              dateStyle: "long",
            })}
            {sourceSubmission && (
              <>
                {" · "}
                <Link
                  href={`/admin/business/inbox/client/${sourceSubmission.id}`}
                  className="text-burgundy underline-offset-4 hover:underline"
                >
                  via inbox
                </Link>
              </>
            )}
          </p>
        </div>
        <StatusBadge status={client.status} />
      </div>

      <form
        action={updateBasics}
        className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2"
      >
        <Field label="Bedrijfsnaam" name="companyName" defaultValue={client.companyName} required />
        <Field
          label="Status"
          name="status"
          as="select"
          defaultValue={client.status}
          options={[
            { value: "prospect", label: "Prospect" },
            { value: "active", label: "Actief" },
            { value: "paused", label: "Gepauzeerd" },
            { value: "archived", label: "Gearchiveerd" },
          ]}
        />
        <Field label="Contactpersoon" name="contactName" defaultValue={client.contactName ?? ""} />
        <Field label="E-mail" name="email" type="email" defaultValue={client.email ?? ""} />
        <Field label="Telefoon" name="phone" defaultValue={client.phone ?? ""} />
        <Field label="Stad" name="city" defaultValue={client.city ?? ""} />
        <div className="md:col-span-2">
          <Field label="Adres" name="address" defaultValue={client.address ?? ""} />
        </div>
        <Field label="KvK-nummer" name="kvk" defaultValue={client.kvk ?? ""} />
        <Field label="Btw / VAT" name="btw" defaultValue={client.btw ?? ""} />
        <Field
          label="Factuur-e-mail"
          name="billingEmail"
          type="email"
          defaultValue={client.billingEmail ?? ""}
        />
        <Field
          label="Betalingstermijn (dagen)"
          name="paymentTermsDays"
          type="number"
          defaultValue={(client.paymentTermsDays ?? 14).toString()}
        />
        <div className="md:col-span-2">
          <Field
            label="Notities (Maarten's tribal knowledge)"
            name="notes"
            as="textarea"
            defaultValue={client.notes ?? ""}
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

      <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Binnenkort op deze pagina</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>· Plaatsings-geschiedenis (Phase 3)</li>
          <li>· Aankomende shifts (Phase 3)</li>
          <li>· Facturen + betalingsstatus (Phase 5)</li>
          <li>· Klant-portal toegang (Phase 6)</li>
          <li>· Gegeven ratings + chef-voorkeuren</li>
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
      : status === "prospect"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    prospect: "Prospect",
    active: "Actief",
    paused: "Gepauzeerd",
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
