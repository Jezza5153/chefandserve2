import { DetailSection } from "@/components/ui/DetailShell";
import type { PendingSuggestion } from "@/lib/domain/profile-suggestions";
import { SUGGESTION_FIELD_LABEL } from "@/lib/domain/profile-suggestions";
import { formatChefRole } from "@/lib/labels";

/**
 * CV-AI-1 owner review: AI-proposed profile enrichments from the chef's CV.
 * Action-bearing — the accept/dismiss server actions live in page.tsx (they
 * close over the route `id`) and arrive as props (mirrors ChangeRequests).
 * Accepting a safe field writes the chef directly; a vakniveau is applied
 * straight away (the owner is the approver). Nothing here shows raw CV text.
 */
function formatVal(field: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "vakniveau" && typeof value === "string") return formatChefRole(value);
  if (Array.isArray(value)) return value.join(", ");
  if (field === "yearsExperience") return `${value} jaar`;
  return String(value);
}

export function CvSuggestions({
  suggestions,
  acceptCvSuggestion,
  dismissCvSuggestion,
}: {
  suggestions: PendingSuggestion[];
  acceptCvSuggestion: (formData: FormData) => Promise<void>;
  dismissCvSuggestion: (formData: FormData) => Promise<void>;
}) {
  if (suggestions.length === 0) return null;

  return (
    <DetailSection className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        AI-voorstellen uit CV
      </h2>
      <p className="mt-1 text-sm text-ink-700">
        De AI las het CV van deze chef en stelt deze profielaanvullingen voor.
        Goedkeuren voert de wijziging direct door.
      </p>

      <ul className="mt-4 space-y-4">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-sky-300 bg-sky-50/50 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                {SUGGESTION_FIELD_LABEL[s.field] ?? s.field}
              </p>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-sky-800">
                uit CV
                {s.confidence != null ? ` · ${Math.round(s.confidence * 100)}%` : ""}
                {s.fieldClass === "sensitive" ? " · ter goedkeuring" : ""}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-ink-900">
              <p>
                <span className="text-ink-500">Huidig:</span>{" "}
                {formatVal(s.field, s.currentValue)}
              </p>
              <p>
                <span className="text-ink-500">Voorgesteld:</span>{" "}
                <strong>{formatVal(s.field, s.proposedValue)}</strong>
              </p>
            </div>

            <form action={acceptCvSuggestion} className="mt-3 flex gap-2">
              <input type="hidden" name="suggestionId" value={s.id} />
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
              >
                Goedkeuren
              </button>
              <button
                type="submit"
                formAction={dismissCvSuggestion}
                className="rounded-full border border-ink-300 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-600 hover:bg-bg-gray"
              >
                Negeren
              </button>
            </form>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}
