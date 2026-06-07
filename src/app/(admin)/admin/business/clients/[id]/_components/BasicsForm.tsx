import { fieldClass } from "@/components/forms/Fields";
import type { clients } from "@/lib/db/schema";

/**
 * Bedrijfsgegevens (basics) editor. ACTION-BEARING: the `updateBasics` server
 * action stays in clients/[id]/page.tsx (it closes over `id`) and is passed in
 * as a same-name prop — mirrors the action-as-prop pattern in
 * chefs/[id]/_components/DocumentUploader.tsx. The form markup is relocated
 * verbatim from page.tsx; the closures `client` and `updateBasics` are now
 * same-name props.
 */
type Client = typeof clients.$inferSelect;

export function BasicsForm({
  client,
  updateBasics,
}: {
  client: Client;
  updateBasics: (formData: FormData) => Promise<void>;
}) {
  return (
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
  );
}

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
  const baseClass = `${fieldClass} placeholder-ink-500`;
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
