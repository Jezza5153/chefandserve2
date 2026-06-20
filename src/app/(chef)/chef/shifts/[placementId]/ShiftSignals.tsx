"use client";

import { useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";
import { type Dict } from "@/lib/i18n/get-dict";

/**
 * CHEF-PR3 — in-shift one-tap status buttons. Onderweg / vertraagd / kan-niet-
 * starten / hulp / "niet veilig". Buttons with sub-options expand inline; each
 * choice posts (kind, detail) to the page's server action, which records the
 * signal + notifies the owner (safety = urgent). Calm front: one obvious tap.
 */
type Option = { key: string; label: string };
type SignalDef = { kind: string; label: string; urgent: boolean; options?: Option[] };

// Mirrors SHIFT_SIGNAL_UI in domain/shift-signals.ts (kept in sync by hand — the
// server re-validates the kind, so a drift can never write a bad value). The kind
// + option keys are the server contract; only the labels are localised (CHEF-PR11e).
function buildSignals(t: Dict): SignalDef[] {
  const s = t.shiftDetail.signals;
  return [
    { kind: "onderweg", label: s.onderweg, urgent: false },
    {
      kind: "vertraagd",
      label: s.vertraagd,
      urgent: false,
      options: [
        { key: "min_15", label: s.vertraagd_min15 },
        { key: "min_30", label: s.vertraagd_min30 },
        { key: "onbekend", label: s.vertraagd_onbekend },
      ],
    },
    {
      kind: "kan_niet_starten",
      label: s.kanNietStarten,
      urgent: true,
      options: [
        { key: "contact_afwezig", label: s.kns_contactAfwezig },
        { key: "ingang_dicht", label: s.kns_ingangDicht },
        { key: "keuken_niet_klaar", label: s.kns_keukenNietKlaar },
        { key: "verkeerde_locatie", label: s.kns_verkeerdeLocatie },
        { key: "anders", label: s.kns_anders },
      ],
    },
    {
      kind: "hulp",
      label: s.hulp,
      urgent: true,
      options: [
        { key: "contact", label: s.hulp_contact },
        { key: "taak", label: s.hulp_taak },
        { key: "anders", label: s.hulp_anders },
      ],
    },
    {
      kind: "langer_doorwerken",
      label: s.langer,
      urgent: false,
      options: [
        { key: "min_30", label: s.langer_min30 },
        { key: "uur_1", label: s.langer_uur1 },
        { key: "klant_vraagt", label: s.langer_klantVraagt },
        { key: "onbekend", label: s.langer_onbekend },
      ],
    },
    { kind: "geen_pauze", label: s.geenPauze, urgent: false },
    { kind: "al_op_locatie", label: s.alOpLocatie, urgent: false },
    { kind: "onveilig", label: s.onveilig, urgent: true },
  ];
}

export function ShiftSignals({
  placementId,
  recordAction,
}: {
  placementId: string;
  recordAction: (formData: FormData) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const SIGNALS = buildSignals(t);

  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-serif text-xl text-ink-900">{t.shiftDetail.signals.heading}</h2>
      <p className="mt-1 text-sm text-ink-700">{t.shiftDetail.signals.intro}</p>

      <div className="mt-4 space-y-2">
        {SIGNALS.map((s) => {
          const base =
            "w-full rounded-full px-5 py-3 text-left font-ui text-[12px] font-medium uppercase tracking-[0.12em] transition-colors";
          const tone = s.urgent
            ? s.kind === "onveilig"
              ? "border border-burgundy bg-burgundy text-white hover:bg-burgundy-900"
              : "border border-burgundy/40 bg-white text-burgundy hover:bg-burgundy/5"
            : "border border-ink-200 bg-white text-ink-800 hover:bg-bg-gray";

          // No sub-options → a direct one-tap submit form.
          if (!s.options) {
            return (
              <form action={recordAction} key={s.kind}>
                <input type="hidden" name="placementId" value={placementId} />
                <input type="hidden" name="kind" value={s.kind} />
                <input type="hidden" name="detail" value="" />
                <button type="submit" className={`${base} ${tone}`}>
                  {s.label}
                </button>
              </form>
            );
          }

          // Has sub-options → toggle reveals the choices (each its own submit).
          const isOpen = open === s.kind;
          return (
            <div key={s.kind}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : s.kind)}
                className={`${base} ${tone} flex items-center justify-between`}
              >
                <span>{s.label}</span>
                <span aria-hidden>{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen ? (
                <div className="mt-1.5 grid gap-1.5 pl-2">
                  {s.options.map((o) => (
                    <form action={recordAction} key={o.key}>
                      <input type="hidden" name="placementId" value={placementId} />
                      <input type="hidden" name="kind" value={s.kind} />
                      <input type="hidden" name="detail" value={o.key} />
                      <button
                        type="submit"
                        className="w-full rounded-full border border-ink-200 bg-bg-gray/50 px-4 py-2 text-left text-sm text-ink-800 hover:bg-bg-gray"
                      >
                        {o.label}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
