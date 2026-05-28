/**
 * Client / venue taxonomy — Cockpit PR-2B. Shared, deterministic.
 *
 * One source of truth for the klanttype + tag vocabulary so the client editor,
 * Chef-360 "top klanttype" ("wat voor klanten doet deze chef"), the chef
 * filters, and the matching reasons all speak the same language. No free text —
 * pick from these so the signal stays structured (the plan's "no faking
 * structured filters from rawPayload" rule).
 */

export const CLIENT_TYPE_OPTIONS = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "beachclub", label: "Beachclub" },
  { value: "event_venue", label: "Eventlocatie" },
  { value: "caterer", label: "Cateraar" },
  { value: "private", label: "Privé" },
  { value: "corporate", label: "Bedrijf" },
  { value: "other", label: "Overig" },
] as const;

export const CLIENT_TAG_OPTIONS = [
  { value: "ontbijt", label: "Ontbijt" },
  { value: "banqueting", label: "Banqueting" },
  { value: "fine_dining", label: "Fine dining" },
  { value: "large_volume", label: "Grote volumes" },
  { value: "early_start", label: "Vroege start" },
  { value: "solo_shift", label: "Solo-shift" },
] as const;

export type ClientTypeValue = (typeof CLIENT_TYPE_OPTIONS)[number]["value"];
export type ClientTagValue = (typeof CLIENT_TAG_OPTIONS)[number]["value"];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CLIENT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
const TAG_LABELS: Record<string, string> = Object.fromEntries(
  CLIENT_TAG_OPTIONS.map((o) => [o.value, o.label]),
);

/** Human label for a client_type value (falls back to the raw value). */
export function clientTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return TYPE_LABELS[value] ?? value;
}

/** Human label for a client_tag value (falls back to the raw value). */
export function clientTagLabel(value: string): string {
  return TAG_LABELS[value] ?? value;
}
