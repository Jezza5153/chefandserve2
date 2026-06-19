"use client";

import { useState } from "react";

/**
 * CHEF-PR3 — in-shift one-tap status buttons. Onderweg / vertraagd / kan-niet-
 * starten / hulp / "niet veilig". Buttons with sub-options expand inline; each
 * choice posts (kind, detail) to the page's server action, which records the
 * signal + notifies the owner (safety = urgent). Calm front: one obvious tap.
 */
type Option = { key: string; label: string };
type SignalDef = { kind: string; label: string; urgent: boolean; options?: Option[] };

// Mirrors SHIFT_SIGNAL_UI in domain/shift-signals.ts (kept in sync by hand — the
// server re-validates the kind, so a drift can never write a bad value).
const SIGNALS: SignalDef[] = [
  { kind: "onderweg", label: "Ik ben onderweg", urgent: false },
  {
    kind: "vertraagd",
    label: "Ik ben vertraagd",
    urgent: false,
    options: [
      { key: "min_15", label: "± 15 min later" },
      { key: "min_30", label: "± 30 min later" },
      { key: "onbekend", label: "Weet nog niet" },
    ],
  },
  {
    kind: "kan_niet_starten",
    label: "Ik ben er, maar kan niet starten",
    urgent: true,
    options: [
      { key: "contact_afwezig", label: "Contactpersoon afwezig" },
      { key: "ingang_dicht", label: "Ingang dicht / kom er niet in" },
      { key: "keuken_niet_klaar", label: "Keuken niet klaar" },
      { key: "verkeerde_locatie", label: "Verkeerde locatie" },
      { key: "anders", label: "Anders" },
    ],
  },
  {
    kind: "hulp",
    label: "Hulp nodig",
    urgent: true,
    options: [
      { key: "contact", label: "Krijg contactpersoon niet te pakken" },
      { key: "taak", label: "Vraag over de opdracht" },
      { key: "anders", label: "Anders" },
    ],
  },
  {
    kind: "langer_doorwerken",
    label: "Ik werk langer door",
    urgent: false,
    options: [
      { key: "min_30", label: "± 30 min langer" },
      { key: "uur_1", label: "± 1 uur langer" },
      { key: "klant_vraagt", label: "Klant vraagt extra" },
      { key: "onbekend", label: "Weet nog niet hoelang" },
    ],
  },
  { kind: "geen_pauze", label: "Geen pauze mogelijk", urgent: false },
  { kind: "al_op_locatie", label: "Ik ben al op locatie", urgent: false },
  { kind: "onveilig", label: "Ik voel me niet veilig / niet correct behandeld", urgent: true },
];

export function ShiftSignals({
  placementId,
  recordAction,
}: {
  placementId: string;
  recordAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-serif text-xl text-ink-900">Tijdens je shift</h2>
      <p className="mt-1 text-sm text-ink-700">
        Eén tik laat Maarten direct weten waar je staat. Niet veilig of een probleem? Druk
        gerust — daar zijn deze knoppen voor.
      </p>

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
