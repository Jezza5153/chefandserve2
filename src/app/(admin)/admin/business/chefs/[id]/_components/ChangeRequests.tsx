import { DetailSection } from "@/components/ui/DetailShell";
import { fieldClass } from "@/components/forms/Fields";
import { profileChangeRequests } from "@/lib/db/schema";
import {
  chefChangeFieldLabel,
  formatChefChangeValue,
} from "@/lib/chef-profile-change-labels";

type ChangeRequestRow = typeof profileChangeRequests.$inferSelect;

/**
 * PR-CHEF-4 admin review: chef-submitted change requests. Action-bearing — the
 * `approveProfileChange` / `rejectProfileChange` server actions stay in page.tsx
 * (they close over the route `id`) and arrive here as props (mirrors
 * DocumentUploader's action-as-prop). The form markup is relocated verbatim; the
 * card chrome is the shared <DetailSection> whose wrapper className is identical to
 * the original `mt-6 rounded-lg border border-ink-200 bg-white p-5` section, and the
 * burgundy <h2> heading is kept inside `children`.
 *
 * `chefChangeFieldLabel` / `formatChefChangeValue` come from the shared
 * `@/lib/chef-profile-change-labels` util — the admin markup, the page's decide
 * action and the assistant's tools all speak about a change the same way.
 */
export function ChangeRequests({
  pendingChanges,
  decidedChanges,
  approveProfileChange,
  rejectProfileChange,
}: {
  pendingChanges: ChangeRequestRow[];
  decidedChanges: ChangeRequestRow[];
  approveProfileChange: (formData: FormData) => Promise<void>;
  rejectProfileChange: (formData: FormData) => Promise<void>;
}) {
  return (
    <DetailSection className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
      {/* @verbatim-start */}
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
                  className={`${fieldClass} placeholder-ink-500`}
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
      {/* @verbatim-end */}
    </DetailSection>
  );
}
