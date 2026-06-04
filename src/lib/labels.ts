/**
 * Human-readable Dutch labels for DB enums.
 *
 * The database stores raw enums (`sous_chef`, `hotel`, …). The UI, emails, PDFs and
 * AI summaries must ALWAYS render through these helpers — never the raw value. This is
 * the single source of truth: form option arrays AND display sites both import here.
 *
 * (Status + money labels live in `hours-labels.ts` — `humanStatus` / `formatEuro`.
 * Do not duplicate them here.)
 */

/** vakniveau enum (also used by shifts.roleNeeded). Source: schema `vakniveauEnum`. */
const CHEF_ROLE_LABELS: Record<string, string> = {
  keukenhulp: "Keukenhulp",
  bediening: "Bediening",
  host: "Host",
  runner: "Runner",
  commis: "Commis",
  chef_de_partie: "Chef de partie",
  sous_chef: "Sous-chef",
  chef_de_cuisine: "Chef de cuisine",
  executive_chef: "Executive chef",
  patissier: "Patissier",
  banqueting: "Banqueting",
  breakfast: "Ontbijtkok",
  roomservice: "Roomservice",
  other: "Overig",
};

/** segment enum. Source: schema `segmentEnum`. */
const SEGMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  fine_dining: "Fine dining",
  hotel: "Hotel",
  banqueting: "Banqueting",
  catering: "Catering",
  event: "Event",
  corporate: "Corporate",
  michelin: "Michelin",
};

/** snake_case → "Snake case" — graceful fallback for unknown / free-text values. */
function humanize(value: string): string {
  const s = value.replace(/_/g, " ").trim();
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Chef vakniveau → human label (e.g. "sous_chef" → "Sous-chef"). */
export function formatChefRole(value: string | null | undefined): string {
  if (!value) return "—";
  return CHEF_ROLE_LABELS[value] ?? humanize(value);
}

/** Shift `roleNeeded` shares the vakniveau enum. */
export const formatShiftRole = formatChefRole;

/** Segment / shift type (e.g. "fine_dining" → "Fine dining"). Empty string if unset. */
export function formatSegment(value: string | null | undefined): string {
  if (!value) return "";
  return SEGMENT_LABELS[value] ?? humanize(value);
}

/** Client type — free text in the DB; map known segment-like values, else humanize. */
export function formatClientType(value: string | null | undefined): string {
  if (!value) return "—";
  return SEGMENT_LABELS[value] ?? humanize(value);
}

/** "Sous-chef · Hotel", skipping blanks. */
export function formatRoleAndSegment(
  role?: string | null,
  segment?: string | null,
): string {
  return [formatChefRole(role), formatSegment(segment)].filter(Boolean).join(" · ");
}
