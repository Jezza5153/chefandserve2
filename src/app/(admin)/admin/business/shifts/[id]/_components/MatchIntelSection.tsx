/**
 * Pair-intel (PR-INTEL-P5) — Maarten's chef×klant memory, captured where a chef
 * and a klant actually co-occur (this dienst). DICTATE: a freeform note + a
 * "klant neemt deze chef weer" verdict → match_intel. Internal-only; never
 * chef/klant-facing. Feeds the AI's `match.intel` tool so the brain can judge a
 * pairing before a voorstel. Mirrors the "Maarten's brein" card pattern.
 */
import { fieldClass } from "@/components/forms/Fields";

export type PairChef = { chefId: string; chefName: string };
export type PairValue = { note: string | null; wouldRehire: boolean | null };

const REHIRE_OPTIONS = [
  { v: "yes", label: "Ja" },
  { v: "no", label: "Nee" },
  { v: "unknown", label: "—" },
] as const;

export function MatchIntelSection({
  clientId,
  clientName,
  placedChefs,
  pairByChef,
  saveAction,
}: {
  clientId: string;
  clientName: string;
  placedChefs: PairChef[];
  pairByChef: Map<string, PairValue>;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  if (placedChefs.length === 0) return null;
  return (
    <section className="mt-12 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">
        Pair-intel · chef × {clientName}
      </h2>
      <p className="mt-1 text-xs text-ink-500">
        Intern — wat jij weet over deze chef <em>bij deze klant</em>. Voedt de AI
        (<code>match.intel</code>) zodat je de bewezen match stuurt. Professionele
        taal: <em>&ldquo;klant vroeg expliciet naar hem&rdquo;</em>.
      </p>
      <div className="mt-4 space-y-4">
        {placedChefs.map((pc) => {
          const pair = pairByChef.get(pc.chefId);
          const rehire = pair?.wouldRehire ?? null;
          return (
            <form
              key={pc.chefId}
              action={saveAction}
              className="rounded-md border border-ink-100 bg-bg-cream/40 p-4"
            >
              <input type="hidden" name="chefId" value={pc.chefId} />
              <input type="hidden" name="clientId" value={clientId} />
              <p className="font-ui text-[11px] font-medium uppercase tracking-[0.16em] text-burgundy">
                {pc.chefName}
              </p>
              <label className="mt-2 block">
                <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                  Notitie
                </span>
                <textarea
                  name="note"
                  rows={2}
                  defaultValue={pair?.note ?? ""}
                  placeholder="bijv. 'klant vroeg expliciet naar hem — rustig, past bij hun gasten'"
                  className={`${fieldClass} placeholder-ink-400`}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                  Klant neemt weer
                </span>
                {REHIRE_OPTIONS.map((opt) => {
                  const checked =
                    (opt.v === "yes" && rehire === true) ||
                    (opt.v === "no" && rehire === false) ||
                    (opt.v === "unknown" && rehire === null);
                  return (
                    <label
                      key={opt.v}
                      className="inline-flex items-center gap-1 text-sm text-ink-700"
                    >
                      <input
                        type="radio"
                        name="wouldRehire"
                        value={opt.v}
                        defaultChecked={checked}
                      />
                      {opt.label}
                    </label>
                  );
                })}
                <button
                  type="submit"
                  className="ml-auto rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
                >
                  Opslaan
                </button>
              </div>
            </form>
          );
        })}
      </div>
    </section>
  );
}
