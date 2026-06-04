/**
 * Status badges — single source for placement + shift status label & tone.
 *
 * The rich "wat gebeurt er nu?" copy lives in `client-shift-labels.ts`
 * (`getClientShiftLabel`); THIS is the lightweight badge layer shared by the
 * klant pills so a raw enum never reaches the UI and the wording can't drift.
 */

const PLACEMENT_LABELS: Record<string, string> = {
  proposed: "Voorgesteld",
  accepted: "Toegezegd",
  confirmed: "Bevestigd",
  cancelled: "Geannuleerd",
  rejected: "Niet beschikbaar",
  no_show: "No-show",
  completed: "Afgerond",
};

const PLACEMENT_TONES: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-700",
  accepted: "bg-blue-100 text-blue-700",
  proposed: "bg-amber-100 text-amber-800",
  completed: "bg-bg-gray text-ink-700",
};

const SHIFT_LABELS: Record<string, string> = {
  request: "Aangevraagd",
  open: "Wacht op planning",
  filled: "Ingevuld",
  confirmed: "Bevestigd",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
};

function humanize(v: string): string {
  const s = v.replace(/_/g, " ").trim();
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function placementStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PLACEMENT_LABELS[status] ?? humanize(status);
}

export function placementStatusTone(status: string | null | undefined): string {
  return (status && PLACEMENT_TONES[status]) || "bg-bg-gray text-ink-500";
}

export function shiftStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return SHIFT_LABELS[status] ?? humanize(status);
}
