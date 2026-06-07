"use client";

/**
 * ChangeRequestModal — klant requests a change to an existing shift
 * (PR-KLANT-2). Inline expanding panel (not a true overlay) so it works with
 * a plain server-action form. Posts kind='change' + topic + reason.
 *
 * Copy never implies the change is automatic — chefs are committed, so this
 * is a request Chef & Serve coordinates.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";

const TOPICS: Array<{ value: string; label: string }> = [
  { value: "datetime", label: "Datum of tijd" },
  { value: "headcount", label: "Aantal personen" },
  { value: "role", label: "Rol (bijv. sous-chef → chef de partie)" },
  { value: "other", label: "Iets anders" },
];

export function ChangeRequestModal({
  action,
  hasOpenRequest,
}: {
  action: (formData: FormData) => Promise<void> | void;
  hasOpenRequest: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (hasOpenRequest) {
    return (
      <span className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-400">
        Wijziging al aangevraagd
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
      >
        Wijziging aanvragen
      </button>

      {open ? (
        <form
          action={action}
          className="mt-3 w-full rounded-lg border border-ink-200 bg-white p-4"
        >
          <input type="hidden" name="kind" value="change" />
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Wat wil je wijzigen?
          </p>
          <div className="mt-2 space-y-1.5">
            {TOPICS.map((t, i) => (
              <label key={t.value} className="flex items-center gap-2 text-sm text-ink-900">
                <input
                  type="radio"
                  name="topic"
                  value={t.value}
                  defaultChecked={i === 0}
                  className="accent-burgundy"
                />
                {t.label}
              </label>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink-500">
              Reden / context (min 5 tekens)
            </span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="Bijv. ‘evenement verschoven naar zaterdag’ of ‘we hebben 2 koks nodig i.p.v. 1’"
              className={`${fieldClass} placeholder-ink-500`}
            />
          </label>

          <p className="mt-2 text-xs text-ink-500">
            Wij koppelen z.s.m. terug. De chef is al ingepland, dus we stemmen
            de wijziging samen af.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Verzoek versturen
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              Annuleer
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
