/**
 * RequestStatusBadge — human status pill for a klant portal submission
 * (PR-KLANT-2). No raw backend statuses: every value maps to plain Dutch.
 *
 * Server component (presentational only).
 */

type SubmissionStatus =
  | "new"
  | "triaged"
  | "converted"
  | "rejected"
  | "duplicate"
  | "cancelled_by_client";

const LABEL: Record<SubmissionStatus, string> = {
  new: "Nieuw aangevraagd",
  triaged: "In behandeling",
  converted: "Ingepland",
  rejected: "Afgewezen",
  duplicate: "In behandeling",
  cancelled_by_client: "Geannuleerd door jou",
};

const NEXT_STEP: Record<SubmissionStatus, string> = {
  new: "Chef & Serve bekijkt je aanvraag.",
  triaged: "Maarten of Gina zoekt een passende chef.",
  converted: "Je shift staat klaar — bekijk de status onder Mijn shifts.",
  rejected: "Deze aanvraag is niet doorgegaan. Bel ons gerust voor uitleg.",
  duplicate: "We hebben deze aanvraag samengevoegd met een bestaande.",
  cancelled_by_client: "Je hebt deze aanvraag ingetrokken.",
};

const TONE: Record<SubmissionStatus, string> = {
  new: "bg-amber-100 text-amber-800",
  triaged: "bg-amber-100 text-amber-800",
  converted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-bg-gray text-ink-500",
  duplicate: "bg-bg-gray text-ink-500",
  cancelled_by_client: "bg-bg-gray text-ink-500",
};

export function requestStatusNextStep(status: string): string {
  return NEXT_STEP[(status as SubmissionStatus)] ?? "";
}

export function requestStatusLabel(status: string): string {
  return LABEL[(status as SubmissionStatus)] ?? status;
}

export function RequestStatusBadge({ status }: { status: string }) {
  const s = status as SubmissionStatus;
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
        TONE[s] ?? "bg-bg-gray text-ink-500"
      }`}
    >
      {LABEL[s] ?? status}
    </span>
  );
}
