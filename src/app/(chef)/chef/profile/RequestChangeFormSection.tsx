"use client";

/**
 * RequestChangeFormSection — UI for the four "vraag wijziging aan" fields:
 *   - Uurtarief (min/max numeric)
 *   - Vakniveau (dropdown)
 *   - Naam (text)
 *   - E-mailadres (email)
 *
 * Each "Verzoek wijziging" button opens a small inline form. Submits to the
 * server action with `field` + `proposed`/`hourlyRateMin`/`hourlyRateMax`
 * + `reason`.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import { formatChefRole } from "@/lib/labels";

const VAKNIVEAU_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "keukenhulp", label: "Keukenhulp" },
  { value: "commis", label: "Commis chef" },
  { value: "chef_de_partie", label: "Chef de partie" },
  { value: "sous_chef", label: "Sous-chef" },
  { value: "chef_de_cuisine", label: "Chef de cuisine" },
  { value: "executive_chef", label: "Executive chef" },
  { value: "patissier", label: "Patissier" },
];

type Props = {
  chef: {
    fullName: string;
    email: string | null;
    vakniveau: string | null;
    hourlyRateMinCents: number | null;
    hourlyRateMaxCents: number | null;
  };
  requestAction: (formData: FormData) => Promise<void> | void;
};

type Field = "fullName" | "email" | "vakniveau" | "hourlyRate" | null;

export function RequestChangeFormSection({ chef, requestAction }: Props) {
  const [open, setOpen] = useState<Field>(null);
  return (
    <section className="mt-10 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Aanpassen via verzoek
      </h2>
      <p className="mt-1 text-xs text-ink-700">
        Naam, e-mail, vakniveau en uurtarief lopen via Chef &amp; Serve. Stuur
        een verzoek; Maarten of Gina bevestigt en past het aan.
      </p>

      <ul className="mt-4 space-y-3">
        <Row
          label="Naam"
          current={chef.fullName}
          onOpen={() => setOpen("fullName")}
        />
        <Row
          label="E-mailadres"
          current={chef.email ?? "—"}
          onOpen={() => setOpen("email")}
        />
        <Row
          label="Vakniveau"
          current={formatChefRole(chef.vakniveau)}
          onOpen={() => setOpen("vakniveau")}
        />
        <Row
          label="Uurtarief"
          current={`€${chef.hourlyRateMinCents ? (chef.hourlyRateMinCents / 100).toFixed(0) : "—"} – €${chef.hourlyRateMaxCents ? (chef.hourlyRateMaxCents / 100).toFixed(0) : "—"}`}
          onOpen={() => setOpen("hourlyRate")}
        />
      </ul>

      {open !== null ? (
        <form
          action={requestAction}
          className="mt-4 rounded-lg border border-ink-200 bg-white p-4"
        >
          <input type="hidden" name="field" value={open} />
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Wijziging voor {labelFor(open)}
          </p>

          {open === "hourlyRate" ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">
                  Min (€/uur)
                </span>
                <input
                  type="number"
                  name="hourlyRateMin"
                  min={0}
                  step={1}
                  defaultValue={chef.hourlyRateMinCents ? (chef.hourlyRateMinCents / 100).toFixed(0) : ""}
                  required
                  className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">
                  Max (€/uur)
                </span>
                <input
                  type="number"
                  name="hourlyRateMax"
                  min={0}
                  step={1}
                  defaultValue={chef.hourlyRateMaxCents ? (chef.hourlyRateMaxCents / 100).toFixed(0) : ""}
                  required
                  className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
              </label>
            </div>
          ) : open === "vakniveau" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">Nieuw vakniveau</span>
              <select
                name="proposed"
                required
                defaultValue={chef.vakniveau ?? ""}
                className={fieldClass}
              >
                <option value="" disabled>
                  Kies een vakniveau…
                </option>
                {VAKNIVEAU_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : open === "email" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">Nieuw e-mailadres</span>
              <input
                type="email"
                name="proposed"
                required
                defaultValue={chef.email ?? ""}
                className={fieldClass}
              />
            </label>
          ) : (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">Nieuwe naam</span>
              <input
                type="text"
                name="proposed"
                required
                defaultValue={chef.fullName}
                className={fieldClass}
              />
            </label>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink-500">
              Toelichting (min 5 tekens)
            </span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="Bijv. ‘Ik heb een nieuw mobiel-nummer’ of ‘meer ervaring met fine-dining sinds april’"
              className={`${fieldClass} placeholder-ink-500`}
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Verzoek versturen
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              Annuleer
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Row({
  label,
  current,
  onOpen,
}: {
  label: string;
  current: string;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-white px-4 py-3">
      <div>
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {label}
        </p>
        <p className="text-sm text-ink-900">{current}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full border border-burgundy/40 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
      >
        Verzoek wijziging
      </button>
    </li>
  );
}

function labelFor(field: Exclude<Field, null>): string {
  return (
    {
      fullName: "naam",
      email: "e-mailadres",
      vakniveau: "vakniveau",
      hourlyRate: "uurtarief",
    } as const
  )[field];
}
