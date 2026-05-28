/**
 * WhatHappensNext — PR-KLANT-0.
 *
 * The "Wat gebeurt er nu?" line. Rendered on every klant surface that
 * shows a shift status (hub, dashboard cards, requests list) so the klant
 * always knows the next step. Pure presentational server component.
 */

export function WhatHappensNext({
  humanStatus,
  nextStep,
  tone = "neutral",
}: {
  humanStatus: string;
  nextStep: string;
  tone?: "neutral" | "action" | "done";
}) {
  const cls =
    tone === "action"
      ? "border-amber-300 bg-amber-50"
      : tone === "done"
        ? "border-emerald-200 bg-emerald-50"
        : "border-ink-200 bg-bg-gray";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
        {humanStatus}
      </p>
      <p className="mt-1 text-sm text-ink-900">
        <span className="font-medium">Wat gebeurt er nu?</span> {nextStep}
      </p>
    </div>
  );
}
