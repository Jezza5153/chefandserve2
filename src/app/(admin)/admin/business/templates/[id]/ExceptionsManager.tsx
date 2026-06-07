"use client";

/**
 * ExceptionsManager — admin adds/removes skip-dates for a template
 * (PR-KLANT-4). "Geen shifts op deze dagen" — Kerst, renovatie, one-offs.
 * The worker subtracts these dates on its next run; already-generated shifts
 * on those dates are NOT auto-removed (admin cancels them manually).
 */

import { fieldClass } from "@/components/forms/Fields";
import { formatIsoDate } from "@/lib/shift-template-format";

type Exception = { id: string; date: string; reason: string | null };

export function ExceptionsManager({
  exceptions,
  addAction,
  removeAction,
}: {
  exceptions: Exception[];
  addAction: (formData: FormData) => Promise<void> | void;
  removeAction: (formData: FormData) => Promise<void> | void;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Uitzonderingen (geen shifts op deze dagen)
      </h2>

      {exceptions.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {exceptions.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 rounded border border-ink-200 px-3 py-2 text-sm"
            >
              <span className="text-ink-900">
                {formatIsoDate(e.date)}
                {e.reason ? (
                  <span className="text-ink-500"> — {e.reason}</span>
                ) : null}
              </span>
              <form action={removeAction}>
                <input type="hidden" name="exceptionId" value={e.id} />
                <button
                  type="submit"
                  className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-ink-500 hover:border-red-300 hover:text-red-700"
                >
                  Verwijder
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-500">Nog geen uitzonderingen.</p>
      )}

      <form action={addAction} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Datum
          </span>
          <input
            type="date"
            name="date"
            required
            className="rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Reden (optioneel)
          </span>
          <input
            type="text"
            name="reason"
            placeholder="Kerstvakantie"
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          + Datum toevoegen
        </button>
      </form>
    </section>
  );
}
