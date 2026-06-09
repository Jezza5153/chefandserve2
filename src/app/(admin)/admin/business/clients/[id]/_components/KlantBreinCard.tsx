/**
 * "Maarten's brein" — PR-INTEL. The judgment layer about a klant: the six fields
 * worth more than 100 form inputs, because they're what Maarten knows and the AI
 * reasons over. INTERNAL-ONLY (never chef/klant-facing). Filled by Maarten here,
 * or later auto-suggested by the AI from his brain-dump. Professional language is
 * nudged by the hints — "geeft echt om rust", never "zeurt".
 */
import type { ClientIntel } from "@/lib/db/schema";
import { fieldClass } from "@/components/forms/Fields";

const FIELDS: Array<{ key: keyof ClientIntel; label: string; hint: string }> = [
  { key: "bestChefType", label: "Beste chef-type", hint: "bijv. 'kalme, ervaren zelfstandige koks; Engels mag'" },
  { key: "caresAbout", label: "Geeft echt om", hint: "bijv. 'geen gedoe + dezelfde gezichten, niet de laagste prijs'" },
  { key: "hiddenRisk", label: "Verborgen risico", hint: "bijv. 'last-minute aanvragen, weinig onboarding in het weekend'" },
  { key: "commercialValue", label: "Commerciële waarde", hint: "bijv. 'hoog volume, betaalt betrouwbaar, upsell mogelijk'" },
  { key: "relationshipStatus", label: "Relatie-status", hint: "bijv. 'warm — al 2 jaar, vaste contactpersoon'" },
  { key: "nextBestAction", label: "Volgende actie", hint: "bijv. 'check-in plannen; vraag of ze vaste vrijdag willen'" },
];

export function KlantBreinCard({
  intel,
  saveAction,
}: {
  intel: ClientIntel | null;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-serif text-lg text-ink-900">Maarten&rsquo;s brein</h2>
      <p className="mt-1 text-xs text-ink-500">
        Intern — wat je over deze klant weet, zodat jij én de AI sneller en slimmer
        plaatsen. Professionele taal: <em>&ldquo;geeft echt om rust&rdquo;</em>,
        niet <em>&ldquo;zeurt&rdquo;</em>.
      </p>
      <form action={saveAction} className="mt-4 space-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              {f.label}
            </span>
            <textarea
              name={f.key}
              rows={2}
              defaultValue={intel?.[f.key] ?? ""}
              placeholder={f.hint}
              className={`${fieldClass} placeholder-ink-400`}
            />
          </label>
        ))}
        <button
          type="submit"
          className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Opslaan
        </button>
      </form>
    </section>
  );
}
