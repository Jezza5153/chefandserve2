/**
 * "Maarten's brein" — PR-INTEL. The judgment layer about a chef: the six fields
 * worth more than 100 form inputs, because they're what Maarten knows and the AI
 * reasons over. INTERNAL-ONLY (never chef/klant-facing). Filled by Maarten here,
 * or later auto-suggested by the AI from his brain-dump. Professional language is
 * nudged by the hints — "needs clear brief", never "difficult".
 */
import type { ChefIntel } from "@/lib/db/schema";
import { fieldClass } from "@/components/forms/Fields";

const FIELDS: Array<{ key: keyof ChefIntel; label: string; hint: string }> = [
  { key: "bestUsedFor", label: "Best ingezet voor", hint: "bijv. 'rustige hotelontbijten + banqueting-prep — snel en netjes'" },
  { key: "notIdealFor", label: "Niet ideaal voor", hint: "bijv. 'chaotische à la carte avonden, fine-dining plating'" },
  { key: "motivatedBy", label: "Gemotiveerd door", hint: "bijv. 'vaste uren + vast team' of 'leren, groeien naar sous'" },
  { key: "needsFromMaarten", label: "Nodig van Maarten", hint: "bijv. 'duidelijke briefing vooraf' of 'appen, niet bellen'" },
  { key: "riskIfIgnored", label: "Risico als genegeerd", hint: "bijv. 'niet dubbelboeken met veel reistijd' — neutraal formuleren" },
  { key: "nextBestAction", label: "Volgende actie", hint: "bijv. '3 weken niet gewerkt — bel voor een shift deze week'" },
];

export function ChefBreinCard({
  intel,
  saveAction,
}: {
  intel: ChefIntel | null;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-serif text-lg text-ink-900">Maarten&rsquo;s brein</h2>
      <p className="mt-1 text-xs text-ink-500">
        Intern — wat je over deze chef weet, zodat jij én de AI sneller en slimmer
        plaatsen. Professionele taal: <em>&ldquo;heeft duidelijke briefing nodig&rdquo;</em>,
        niet <em>&ldquo;lastig&rdquo;</em>.
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
