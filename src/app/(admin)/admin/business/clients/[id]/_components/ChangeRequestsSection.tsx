import { fieldClass } from "@/components/forms/Fields";
import type { clientChangeRequests } from "@/lib/db/schema";

/**
 * Wijzigingsverzoeken — portal-submitted profile/billing change requests with
 * approve/reject. ACTION-BEARING: the `approveClientChange` / `rejectClientChange`
 * server actions stay in clients/[id]/page.tsx (they close over `id` and call the
 * shared `decideClientChange`) and are passed in as props. `clientChangeFieldLabel`
 * is also kept in page.tsx (the decide action uses it for the outcome email) and
 * passed in as a same-name prop. The section markup is relocated verbatim from
 * page.tsx; closures (`pendingChanges`, `decidedChanges`) are now same-name props.
 */
type ChangeRequest = typeof clientChangeRequests.$inferSelect;

export function ChangeRequestsSection({
  pendingChanges,
  decidedChanges,
  approveClientChange,
  rejectClientChange,
  clientChangeFieldLabel,
}: {
  pendingChanges: ChangeRequest[];
  decidedChanges: ChangeRequest[];
  approveClientChange: (formData: FormData) => Promise<void>;
  rejectClientChange: (formData: FormData) => Promise<void>;
  clientChangeFieldLabel: (field: string) => string;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Wijzigingsverzoeken</h2>
      <p className="mt-1 text-sm text-ink-700">
        Bedrijfs- en facturatiegegevens die de klant via het portaal heeft
        aangevraagd. Goedkeuren voert de wijziging direct door.
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
                  {clientChangeFieldLabel(r.field)}
                </p>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                  Wacht op akkoord
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-sm text-ink-900">
                <p>
                  <span className="text-ink-500">Huidig:</span>{" "}
                  {formatChangeValue(r.currentValue)}
                </p>
                <p>
                  <span className="text-ink-500">Voorgesteld:</span>{" "}
                  <strong>{formatChangeValue(r.proposedValue)}</strong>
                </p>
                {r.reason ? (
                  <p className="text-xs text-ink-500">
                    Toelichting klant: {r.reason}
                  </p>
                ) : null}
              </div>

              <form action={approveClientChange} className="mt-3">
                <input type="hidden" name="requestId" value={r.id} />
                <textarea
                  name="decisionNotes"
                  rows={2}
                  placeholder="Optionele toelichting (gedeeld met de klant)"
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
                    formAction={rejectClientChange}
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
                  {clientChangeFieldLabel(r.field)} →{" "}
                  {formatChangeValue(r.proposedValue)}
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
    </section>
  );
}

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
