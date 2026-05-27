"use client";

/**
 * ConsentGate — plain-Dutch modal shown when the user hasn't yet
 * consented to the current version of the data-usage agreement.
 *
 * "AVG consent" NEVER appears in the user-facing copy — we say
 * "Gegevensgebruik akkoord" (per the plan's UX rule #10).
 *
 * Two buttons: Akkoord (writes consent_log row via server action) /
 * Lees privacyverklaring (link to /privacy-chef or /privacy-klant).
 *
 * When AVG_CONSENT_ENFORCED is true, this modal cannot be dismissed
 * without action (UX prop `enforce={true}`). When false (V1 default),
 * a small dismiss link appears but the user can continue.
 */

import { useState } from "react";

type Props = {
  enforce: boolean;
  privacyHref: string;
  acceptAction: () => Promise<void>;
};

export function ConsentGate({ enforce, privacyHref, acceptAction }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && !enforce) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="w-full max-w-md rounded-t-lg bg-white p-6 shadow-xl sm:rounded-lg">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Voor we starten
        </p>
        <h2 id="consent-title" className="mt-2 font-serif text-xl text-ink-900">
          Gegevensgebruik akkoord
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          Om je shifts, uren en betalingen goed te regelen verwerken we je
          gegevens — je naam, contactgegevens, beschikbaarheid, documenten
          en gewerkte uren.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          We gebruiken dit alleen voor Chef &amp; Serve planning,
          communicatie en administratie. Wij verkopen je gegevens nooit
          aan derden.
        </p>

        <form action={acceptAction} className="mt-5 flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Akkoord en doorgaan
          </button>
          <a
            href={privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
          >
            Lees privacyverklaring
          </a>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          Je kunt later altijd vragen welke gegevens we van je hebben —
          sommige administratie moeten we wettelijk bewaren.
        </p>

        {!enforce ? (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-3 font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:underline"
          >
            (later beslissen)
          </button>
        ) : null}
      </div>
    </div>
  );
}
