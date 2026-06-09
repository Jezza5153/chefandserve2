/**
 * ClientDataOverview — AVG transparency: a plain-Dutch, read-only overview of exactly which
 * company data Chef & Serve holds about this klant, grouped by the same sections as the onboarding
 * form. Renders the klant's OWN data back to the logged-in klant (transparency, not a leak); pairs
 * with the privacy-request form so "wat hebben jullie van mij?" is answered on the same page.
 *
 * Pure presentational server component — no client JS, no mutations. Billing data is intentionally
 * absent here (it lives with the invoicing team); this mirrors the onboarding form's scope.
 */
import type { OnboardingInitial } from "@/lib/domain/client-onboarding";
import type { FieldDTO, FormDTO } from "@/lib/forms/types";

type Cell = OnboardingInitial[string] | undefined;

function display(field: FieldDTO, cell: Cell): string {
  if (field.type === "file") return cell?.filename || "— geen bestand —";
  const v = cell?.value;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  if (field.type === "boolean") return v === true ? "Ja" : v === false ? "Nee" : "—";
  if (Array.isArray(v)) {
    return v.map((x) => field.options?.find((o) => o.value === x)?.label ?? String(x)).join(", ");
  }
  if (field.type === "select") return field.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

export function ClientDataOverview({ form, initial }: { form: FormDTO; initial: OnboardingInitial }) {
  return (
    <div className="space-y-4">
      {form.sections.map((section) => {
        const rows = section.fields.filter((f) => f.type !== "heading");
        if (rows.length === 0) return null;
        return (
          <div key={section.id} className="rounded-lg border border-ink-200 bg-white p-4">
            <h3 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{section.title}</h3>
            {section.description ? <p className="mt-1 text-xs text-ink-500">{section.description}</p> : null}
            <dl className="mt-3 divide-y divide-ink-100">
              {rows.map((field) => (
                <div key={field.id} className="flex items-start justify-between gap-4 py-1.5">
                  <dt className="text-sm text-ink-600">{field.label}</dt>
                  <dd className="text-right text-sm font-medium text-ink-900">{display(field, initial[field.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
