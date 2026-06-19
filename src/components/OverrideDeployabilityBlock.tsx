"use client";

/**
 * Override-with-reason panel. Two uses:
 *  - P3a compliance hard-gate: a 'blocked' chef's one-click button is replaced by this;
 *    posts `overrideReason` → audited placements.compliance_override.
 *  - P3c-2 margin guard: a NEGATIVE-margin candidate's button is replaced by this
 *    (heading/reasonField overridden); posts `marginOverrideReason` → audited
 *    placements.margin_override.
 * Mirrors the dismiss/cancel-with-reason pattern. Defaults keep the compliance behaviour
 * so existing callers are unchanged.
 */

import { useState } from "react";

export function OverrideDeployabilityBlock({
  action,
  hidden,
  blockers,
  cta = "Voorstel",
  heading = "Niet inzetbaar — vrijgeven kan alleen met reden",
  reasonField = "overrideReason",
  placeholder = "Bijv. ‘VOG is mondeling bevestigd door manager, kopie volgt vrijdag’",
}: {
  action: (formData: FormData) => Promise<void> | void;
  /** Hidden inputs the propose action needs (shiftId/chefId/matchScore — values vary per surface). */
  hidden: Record<string, string | number>;
  /** PII-free Dutch chips (compliance: verdict.blockers · margin: "marge -€X"). */
  blockers: string[];
  /** Label for the final submit button, matching the surface ("Stel voor" / "Voorstel"). */
  cta?: string;
  /** Panel heading (default = compliance). */
  heading?: string;
  /** Form field name for the reason (default "overrideReason"; margin uses "marginOverrideReason"). */
  reasonField?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-red-300 bg-red-50/50 p-3">
      <p className="font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-red-700">
        {heading}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {blockers.map((b) => (
          <li key={b} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
            {b}
          </li>
        ))}
      </ul>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-red-700 hover:bg-red-50"
        >
          Toch voorstellen (met reden)
        </button>
      ) : (
        <form action={action} className="mt-2 space-y-2">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={String(v)} />
          ))}
          <textarea
            name={reasonField}
            rows={2}
            required
            minLength={10}
            placeholder={placeholder}
            className="w-full rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 placeholder-ink-400 focus:border-red-400 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-red-700 px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-white hover:bg-red-800"
            >
              {cta} (met reden)
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:bg-bg-gray"
            >
              Annuleer
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
