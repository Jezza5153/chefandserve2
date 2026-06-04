import Link from "next/link";

import { getFormForBuilder } from "@/lib/domain/forms";
import type { FieldDTO, FieldOption } from "@/lib/forms/types";
import { requireAnyRole } from "@/lib/permissions";

import {
  createCustomField,
  createSection,
  deleteField,
  deleteSection,
  moveField,
  moveSection,
  publishForm,
  updateField,
  updateSection,
} from "./actions";

export const metadata = { title: "Formulier bewerken", robots: { index: false } };
export const dynamic = "force-dynamic";

const CUSTOM_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "boolean",
  "heading",
] as const;

const FLASH: Record<string, string> = {
  published: "✓ Formulier gepubliceerd.",
  title: "Titel is verplicht.",
  label: "Label is verplicht.",
  section_has_system: "Deze sectie bevat systeemvelden en kan niet worden verwijderd.",
  system_locked: "Systeemvelden kunnen niet worden verwijderd (payroll/KPI's hangen eraan).",
};

function optionsToText(options: FieldOption[] | null): string {
  return (options ?? []).map((o) => `${o.value}:${o.label}`).join("\n");
}

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAnyRole(["owner", "planner"], "/admin/business");
  const { slug } = await params;
  const sp = await searchParams;
  const form = await getFormForBuilder(slug);

  if (!form) {
    return (
      <div>
        <h1 className="font-serif text-2xl text-ink-900">Formulier niet gevonden</h1>
        <Link href="/admin/business/forms" className="mt-4 inline-block text-sm text-burgundy hover:underline">
          ← Terug
        </Link>
      </div>
    );
  }

  const flash = sp.ok ? FLASH[sp.ok] : sp.err ? FLASH[sp.err] : null;
  const flashTone = sp.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-burgundy/30 bg-burgundy/5 text-burgundy";

  return (
    <div className="max-w-3xl">
      <Link href="/admin/business/forms" className="text-sm text-burgundy hover:underline">
        ← Alle formulieren
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-ink-900">{form.title}</h1>
          <p className="mt-1 font-ui text-[11px] uppercase tracking-[0.18em] text-ink-500">
            /{form.slug} · v{form.version}
          </p>
        </div>
        <form action={publishForm.bind(null, slug, form.id)}>
          <button className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
            Publiceren
          </button>
        </form>
      </div>

      {flash ? <p className={`mt-4 rounded border px-4 py-2 text-sm ${flashTone}`}>{flash}</p> : null}

      <div className="mt-6 space-y-5">
        {form.sections.map((section, si) => (
          <section key={section.id} className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{section.title}</h2>
              <div className="flex items-center gap-1">
                <MoveButtons action={moveSection.bind(null, slug, form.id, section.id)} canUp={si > 0} canDown={si < form.sections.length - 1} />
              </div>
            </div>

            <details className="mt-2">
              <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:text-burgundy">
                Sectie bewerken
              </summary>
              <form action={updateSection.bind(null, slug, section.id)} className="mt-2 grid gap-2">
                <input name="title" defaultValue={section.title} className={INPUT} />
                <input name="description" defaultValue={section.description ?? ""} placeholder="Omschrijving (optioneel)" className={INPUT} />
                <div className="flex gap-2">
                  <button className={BTN_PRIMARY}>Opslaan</button>
                  <button formAction={deleteSection.bind(null, slug, section.id)} className={BTN_DANGER}>
                    Sectie verwijderen
                  </button>
                </div>
              </form>
            </details>

            <ul className="mt-3 divide-y divide-ink-100">
              {section.fields.map((field, fi) => (
                <li key={field.id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-900">
                        {field.label}
                        {field.required ? <span className="text-burgundy"> *</span> : null}
                        {!field.isVisible ? <span className="ml-2 text-[11px] text-ink-400">(verborgen)</span> : null}
                      </p>
                      <p className="font-ui text-[10px] uppercase tracking-[0.12em] text-ink-400">
                        {field.type} · {field.key}{" "}
                        <span className={field.kind === "system" ? "text-burgundy" : "text-ink-400"}>
                          · {field.kind === "system" ? "systeem" : "eigen"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <MoveButtons action={moveField.bind(null, slug, section.id, field.id)} canUp={fi > 0} canDown={fi < section.fields.length - 1} />
                    </div>
                  </div>

                  <details className="mt-1">
                    <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:text-burgundy">
                      Bewerken
                    </summary>
                    <FieldEditForm slug={slug} field={field} />
                  </details>
                </li>
              ))}
            </ul>

            {/* add custom field */}
            <details className="mt-3">
              <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline">
                + Eigen veld toevoegen
              </summary>
              <form action={createCustomField.bind(null, slug, form.id, section.id)} className="mt-2 grid gap-2">
                <input name="label" placeholder="Label (bijv. Allergieën)" className={INPUT} required />
                <select name="type" className={INPUT} defaultValue="text">
                  {CUSTOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input name="helpText" placeholder="Helptekst (optioneel)" className={INPUT} />
                <textarea
                  name="options"
                  rows={3}
                  placeholder={"Opties (alleen voor select/multiselect), één per regel:\nwaarde:Label"}
                  className={INPUT}
                />
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" name="required" className="h-4 w-4 rounded border-ink-300 text-burgundy" /> Verplicht
                </label>
                <button className={BTN_PRIMARY}>Veld toevoegen</button>
              </form>
            </details>
          </section>
        ))}
      </div>

      {/* add section */}
      <details className="mt-5">
        <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
          + Nieuwe sectie
        </summary>
        <form action={createSection.bind(null, slug, form.id)} className="mt-2 flex gap-2">
          <input name="title" placeholder="Sectietitel" className={INPUT} required />
          <button className={BTN_PRIMARY}>Toevoegen</button>
        </form>
      </details>
    </div>
  );
}

const INPUT =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const BTN_PRIMARY =
  "rounded-full bg-burgundy px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900";
const BTN_DANGER =
  "rounded-full border border-red-300 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50";

function MoveButtons({
  action,
  canUp,
  canDown,
}: {
  action: (dir: string, formData: FormData) => void | Promise<void>;
  canUp: boolean;
  canDown: boolean;
}) {
  return (
    <>
      <form action={action.bind(null, "up")}>
        <button disabled={!canUp} className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-600 disabled:opacity-30">
          ↑
        </button>
      </form>
      <form action={action.bind(null, "down")}>
        <button disabled={!canDown} className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-600 disabled:opacity-30">
          ↓
        </button>
      </form>
    </>
  );
}

function FieldEditForm({ slug, field }: { slug: string; field: FieldDTO }) {
  const system = field.kind === "system";
  return (
    <form action={updateField.bind(null, slug, field.id)} className="mt-2 grid gap-2">
      {system ? (
        <p className="rounded bg-bg-gray px-2 py-1 text-[11px] text-ink-500">
          Systeemveld — type ({field.type}) staat vast; payroll/KPI&apos;s hangen eraan. Label, helptekst, verplicht
          en zichtbaarheid kun je wel aanpassen.
        </p>
      ) : null}
      <input name="label" defaultValue={field.label} className={INPUT} />
      <input name="placeholder" defaultValue={field.placeholder ?? ""} placeholder="Placeholder (optioneel)" className={INPUT} />
      <input name="helpText" defaultValue={field.helpText ?? ""} placeholder="Helptekst (optioneel)" className={INPUT} />
      {!system ? (
        <>
          <select name="type" defaultValue={field.type} className={INPUT}>
            {CUSTOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            name="options"
            rows={3}
            defaultValue={optionsToText(field.options)}
            placeholder={"Opties (select/multiselect), één per regel: waarde:Label"}
            className={INPUT}
          />
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="required" defaultChecked={field.required} className="h-4 w-4 rounded border-ink-300 text-burgundy" />
          Verplicht
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="isVisible" defaultChecked={field.isVisible} className="h-4 w-4 rounded border-ink-300 text-burgundy" />
          Zichtbaar
        </label>
      </div>
      <div className="flex gap-2">
        <button className={BTN_PRIMARY}>Opslaan</button>
        {!system ? (
          <button formAction={deleteField.bind(null, slug, field.id)} className={BTN_DANGER}>
            Verwijderen
          </button>
        ) : null}
      </div>
    </form>
  );
}
