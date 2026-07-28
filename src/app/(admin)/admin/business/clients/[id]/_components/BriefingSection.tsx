"use client";

/**
 * Klant briefing — the practical half of the notes, made chef-visible on purpose.
 *
 * Two columns. On the left, what a chef actually sees before they leave home. On the right,
 * candidate lines pulled out of the migrated notes with a button to lift one into a field.
 *
 * The suggestion is never applied automatically. The notes blob is the owner's internal
 * layer — it quotes conflicts, names other klanten and records rates — so a line only
 * becomes chef-visible when a person reads it and says yes. The suggestion lands in the
 * textarea rather than in the database, which keeps the edit before the save.
 */
import { useRef } from "react";

import type { BriefingVeld, BriefingVoorstel } from "@/lib/domain/klant-briefing";
import { BRIEFING_CHEF_LABEL, BRIEFING_LABEL } from "@/lib/domain/klant-briefing";

const VELDEN: BriefingVeld[] = ["arrivalInstructions", "parkingInfo", "dressCodeDefault", "bringAlong"];

const PLAATSHOUDER: Record<BriefingVeld, string> = {
  arrivalInstructions: "Personeelsingang aan de achterzijde, melden bij de receptie.",
  parkingInfo: "Parkeergarage onder het hotel, gratis met de pas van de receptie.",
  dressCodeDefault: "Zwarte broek, witte koksbuis, dichte schoenen.",
  bringAlong: "Eigen messen.",
};

export function BriefingSection({
  huidig,
  voorstellen,
  opslaan,
}: {
  huidig: Record<BriefingVeld, string | null>;
  voorstellen: BriefingVoorstel[];
  opslaan: (formData: FormData) => Promise<void>;
}) {
  const ingevuld = VELDEN.filter((v) => huidig[v]?.trim()).length;
  const formRef = useRef<HTMLFormElement>(null);

  /** Zet een voorstel in het bijbehorende tekstvak. Opslaan blijft een aparte stap. */
  const overnemen = (veld: BriefingVeld, regel: string) => {
    const veldEl = formRef.current?.elements.namedItem(veld);
    if (veldEl instanceof HTMLTextAreaElement) {
      veldEl.value = veldEl.value.trim() ? `${veldEl.value.trim()}\n${regel}` : regel;
      veldEl.focus();
    }
  };

  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-ink-900">Briefing voor de chef</h2>
        <p className="text-xs text-ink-500">
          {ingevuld === 0
            ? "Nog niets ingevuld — de chef ziet hier niets."
            : `${ingevuld} van de 4 velden ingevuld · dit ziet de chef op zijn dienst`}
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Waar meldt een chef zich, waar parkeert hij, wat draagt hij, wat neemt hij mee. Dit is het enige deel van
        het dossier dat de chef te zien krijgt — de rest van je notities blijft intern.
      </p>

      <form ref={formRef} action={opslaan} className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          {VELDEN.map((veld) => (
            <label key={veld} className="block">
              <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                {BRIEFING_LABEL[veld]}{" "}
                <span className="normal-case tracking-normal text-ink-400">
                  — chef ziet: &ldquo;{BRIEFING_CHEF_LABEL[veld]}&rdquo;
                </span>
              </span>
              <textarea
                name={veld}
                defaultValue={huidig[veld] ?? ""}
                rows={2}
                placeholder={PLAATSHOUDER[veld]}
                className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </label>
          ))}
          <button
            type="submit"
            className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
          >
            Briefing opslaan
          </button>
        </div>

        {/* Voorstellen uit de oude notities */}
        <div className="rounded-lg border border-ink-200 bg-bg-gray/40 p-4">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Gevonden in het oude dossier
          </p>
          {voorstellen.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">
              Geen bruikbare regels gevonden in de notities van deze klant.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-500">
                Klik om over te nemen in het veld links. Lees hem eerst — er kan meer in staan dan bedoeld, en je
                kunt hem daarna nog aanpassen.
              </p>
              <ul className="mt-3 space-y-2">
                {voorstellen.slice(0, 8).map((v, i) => (
                  <li key={`${v.veld}-${i}`} className="rounded border border-ink-200 bg-white p-2.5 text-sm">
                    <p className="font-ui text-[10px] uppercase tracking-wider text-burgundy">
                      {BRIEFING_LABEL[v.veld]}
                      {v.datum ? <span className="ml-1 text-ink-400">· {v.datum}</span> : null}
                    </p>
                    <p className="mt-1 text-ink-800">{v.regel}</p>
                    <button
                      type="button"
                      className="mt-1.5 font-ui text-[10px] uppercase tracking-wider text-burgundy hover:underline"
                      onClick={() => overnemen(v.veld, v.regel)}
                    >
                      Overnemen ↑
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
