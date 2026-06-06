/**
 * RequestStatusBadge — human status pill for a klant portal submission
 * (PR-KLANT-2). No raw backend statuses: every value maps to plain Dutch.
 *
 * Server component (presentational only).
 */

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

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

const TONE: Record<SubmissionStatus, StatusTone> = {
  new: "amber",
  triaged: "amber",
  converted: "green",
  rejected: "gray",
  duplicate: "gray",
  cancelled_by_client: "gray",
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
    <StatusBadge
      tone={TONE[s] ?? "gray"}
      label={LABEL[s] ?? status}
      className="shrink-0"
    />
  );
}
