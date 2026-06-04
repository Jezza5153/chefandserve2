/**
 * Profile completeness — Cockpit PR-1.5. Pure + deterministic.
 *
 * Scores how usable a chef profile is for matching, so the cockpit never fakes
 * confidence on a half-empty profile and the missing-data workflow (PR-2.1) knows
 * what to ask for. PR-1.5 scores the fields that exist today; PR-2 adds postcode/
 * transport/preferences to the input + the required list (the function already
 * tolerates those being absent).
 */

export type CompletenessInput = {
  vakniveau?: string | null;
  city?: string | null;
  segments?: string[] | null;
  yearsExperience?: number | null;
  hourlyRateMinCents?: number | null;
  hourlyRateMaxCents?: number | null;
  email?: string | null;
  phone?: string | null;
  specialties?: string | null;
  languages?: string[] | null;
  // PR-2 adds: postcode, transportMode, preferences (optional here already).
  postcode?: string | null;
  transportMode?: string | null;
  preferences?: string[] | null;
};

export type CompletenessLabel = "compleet" | "bruikbaar" | "mist data" | "onbruikbaar";

export type Completeness = {
  score: number; // 0–100
  missingCritical: string[];
  missingNiceToHave: string[];
  canMatch: boolean;
  canEstimateTravel: boolean;
  label: CompletenessLabel;
};

const has = (v: unknown): boolean =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0);

const hasRate = (c: CompletenessInput): boolean =>
  has(c.hourlyRateMinCents) || has(c.hourlyRateMaxCents);

/** Critical = needed to match well; nice-to-have = improves the match. */
export function getProfileCompleteness(c: CompletenessInput): Completeness {
  const critical: { key: string; ok: boolean }[] = [
    { key: "vakniveau", ok: has(c.vakniveau) },
    { key: "stad", ok: has(c.city) },
    { key: "tarief", ok: hasRate(c) },
    { key: "contact", ok: has(c.email) || has(c.phone) },
  ];
  const niceToHave: { key: string; ok: boolean }[] = [
    { key: "segmenten", ok: has(c.segments) },
    { key: "ervaring", ok: has(c.yearsExperience) },
    { key: "specialiteiten", ok: has(c.specialties) },
    { key: "talen", ok: has(c.languages) },
    { key: "postcode", ok: has(c.postcode) },
    { key: "vervoer", ok: has(c.transportMode) },
    { key: "voorkeuren", ok: has(c.preferences) },
  ];

  const missingCritical = critical.filter((f) => !f.ok).map((f) => f.key);
  const missingNiceToHave = niceToHave.filter((f) => !f.ok).map((f) => f.key);

  // Critical worth 70%, nice-to-have 30%.
  const critScore = (critical.filter((f) => f.ok).length / critical.length) * 70;
  const niceScore = (niceToHave.filter((f) => f.ok).length / niceToHave.length) * 30;
  const score = Math.round(critScore + niceScore);

  const canMatch = has(c.vakniveau) && has(c.city);
  const canEstimateTravel = has(c.postcode);

  const label: CompletenessLabel =
    score >= 80 ? "compleet" : score >= 55 ? "bruikbaar" : score >= 25 ? "mist data" : "onbruikbaar";

  return { score, missingCritical, missingNiceToHave, canMatch, canEstimateTravel, label };
}

/* ============================================================================
 * Onboarding readiness (PR-KPI) — "can we legally deploy + pay this chef?"
 *
 * Distinct from match-completeness above: this scores the payroll/identity data
 * the native onboarding collects (BSN, IBAN, ID, DOB, address, bank holder,
 * role/employment). It's the KPI Maarten/planner act on before a first shift.
 * Sensitive values are passed as booleans (filled?) — never plaintext.
 * ========================================================================== */

export type OnboardingInput = {
  firstName?: string | null;
  surname?: string | null;
  dateOfBirth?: unknown; // date or null — only presence matters
  bsnFilled?: boolean; // chefs.bsn_encrypted present
  ibanFilled?: boolean; // chefs.iban_encrypted present
  bankAccountHolderName?: string | null;
  idType?: string | null;
  idNumberFilled?: boolean; // chefs.id_number_encrypted present
  idExpiresAt?: Date | string | null;
  street?: string | null;
  houseNumber?: string | null;
  postcode?: string | null;
  applyingAs?: string | null;
  employmentType?: string | null;
  /** chef_documents present, keyed by type. */
  hasIdFront?: boolean;
  hasIdBack?: boolean;
};

export type OnboardingReadiness = {
  score: number; // 0–100
  missingCritical: string[];
  ready: boolean; // all payroll-critical fields present
  idExpired: boolean;
  idExpiringSoon: boolean; // within 60 days
};

export function getOnboardingReadiness(c: OnboardingInput): OnboardingReadiness {
  // Critical = legally required to deploy + pay.
  const critical: { key: string; ok: boolean }[] = [
    { key: "naam", ok: has(c.firstName) && has(c.surname) },
    { key: "geboortedatum", ok: has(c.dateOfBirth) },
    { key: "adres", ok: has(c.street) && has(c.houseNumber) && has(c.postcode) },
    { key: "BSN", ok: !!c.bsnFilled },
    { key: "IBAN", ok: !!c.ibanFilled },
    { key: "rekeninghouder", ok: has(c.bankAccountHolderName) },
    { key: "ID-type", ok: has(c.idType) },
    { key: "ID-nummer", ok: !!c.idNumberFilled },
    { key: "ID-vervaldatum", ok: has(c.idExpiresAt) },
    { key: "ID-kopie", ok: !!c.hasIdFront && !!c.hasIdBack },
    { key: "rol", ok: has(c.applyingAs) },
    { key: "dienstverband", ok: has(c.employmentType) },
  ];
  const missingCritical = critical.filter((f) => !f.ok).map((f) => f.key);
  const score = Math.round((critical.filter((f) => f.ok).length / critical.length) * 100);

  let idExpired = false;
  let idExpiringSoon = false;
  if (c.idExpiresAt) {
    const exp = new Date(c.idExpiresAt).getTime();
    const now = Date.now();
    idExpired = exp < now;
    idExpiringSoon = !idExpired && exp < now + 60 * 24 * 60 * 60 * 1000;
  }

  return { score, missingCritical, ready: missingCritical.length === 0, idExpired, idExpiringSoon };
}
