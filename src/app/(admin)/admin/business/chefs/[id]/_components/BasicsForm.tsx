import { fieldClass } from "@/components/forms/Fields";
import { chefs } from "@/lib/db/schema";

type ChefRow = typeof chefs.$inferSelect;

/**
 * Chef basics editor. Action-bearing — `updateBasics` stays in page.tsx (it closes
 * over the route `id`) and arrives as a prop. The whole `<form>` IS the card here
 * (not a <section>), so DetailSection does not apply; the form markup, including its
 * `mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2`
 * chrome, is relocated verbatim.
 *
 * `VAKNIVEAU_OPTIONS` / `SEGMENT_OPTIONS` are passed in (same names) because the
 * page's updateBasics action also depends on VAKNIVEAU_OPTIONS' literal type.
 */
export function BasicsForm({
  chef,
  updateBasics,
  VAKNIVEAU_OPTIONS,
  SEGMENT_OPTIONS,
}: {
  chef: ChefRow;
  updateBasics: (formData: FormData) => Promise<void>;
  VAKNIVEAU_OPTIONS: readonly string[];
  SEGMENT_OPTIONS: readonly string[];
}) {
  return (
    /* @verbatim-start */
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
    /* @verbatim-end */
  );
}

/* ----- helpers (relocated verbatim from page.tsx) ----- */

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
