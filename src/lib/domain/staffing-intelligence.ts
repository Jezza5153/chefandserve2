/**
 * Staffing intelligence — Cockpit PR-1.5 (extended in PR-3.1). Pure + deterministic.
 *
 * Turns a candidate chef's signals into proof badges, honest warnings, and a
 * confidence label, so "Vul deze dienst" shows WHY a chef fits and what's
 * uncertain — never a bare score. PR-3.1 adds distance/margin/favorite/blocked
 * + ranking; the signal shape already reserves room for them.
 */

import type { Completeness } from "./profile-completeness";

export type Availability = "available" | "unavailable" | "maybe" | "unknown";

export type CandidateSignals = {
  matchScore?: number | null; // 0–100 from smart-match
  rateCents?: number | null; // chef hourly rate
  availability?: Availability; // for the shift date
  workedHereCount?: number; // prior placements for this client
  lastContactDays?: number | null; // days since last contact_log
  completeness?: Completeness | null;
  // PR-3.1: distanceKm, marginCents, isFavorite, isBlocked
};

export type BadgeTone = "green" | "amber" | "blue" | "grey" | "red";
export type Badge = { label: string; tone: BadgeTone };

/** Compact proof chips — what makes (or weakens) this candidate. */
export function getChefCandidateBadges(s: CandidateSignals): Badge[] {
  const badges: Badge[] = [];
  if (typeof s.matchScore === "number") {
    badges.push({
      label: `match ${s.matchScore}`,
      tone: s.matchScore >= 80 ? "green" : s.matchScore >= 55 ? "blue" : "amber",
    });
  }
  if (s.workedHereCount && s.workedHereCount > 0) {
    badges.push({ label: `hier ${s.workedHereCount}×`, tone: "green" });
  }
  if (s.availability) {
    const meta: Record<Availability, { label: string; tone: BadgeTone }> = {
      available: { label: "beschikbaar", tone: "green" },
      unavailable: { label: "niet beschikbaar", tone: "red" },
      maybe: { label: "misschien", tone: "amber" },
      unknown: { label: "beschikbaarheid ?", tone: "amber" },
    };
    badges.push(meta[s.availability]);
  }
  if (typeof s.rateCents === "number" && s.rateCents > 0) {
    badges.push({ label: `€${(s.rateCents / 100).toFixed(0)}/u`, tone: "grey" });
  }
  if (s.completeness) {
    badges.push({
      label: `profiel ${s.completeness.score}%`,
      tone: s.completeness.score >= 80 ? "green" : s.completeness.score >= 55 ? "amber" : "red",
    });
  }
  return badges;
}

/** Honest, deterministic warnings — never hide weak/missing data. */
export function getChefCandidateWarnings(s: CandidateSignals): string[] {
  const w: string[] = [];
  if (!s.availability || s.availability === "unknown") w.push("beschikbaarheid onbekend");
  if (!(typeof s.rateCents === "number" && s.rateCents > 0)) w.push("geen tarief");
  if (s.completeness && s.completeness.missingCritical.length > 0) {
    w.push(`mist: ${s.completeness.missingCritical.join(", ")}`);
  }
  return w;
}

export type Confidence = { label: "hoog" | "midden" | "laag"; reason: string | null };

/** Deterministic confidence — decision support, not AI. Honest about uncertainty. */
export function getMatchConfidenceLabel(s: CandidateSignals): Confidence {
  const score = s.matchScore ?? 0;
  const canMatch = s.completeness ? s.completeness.canMatch : true;
  if (s.availability === "unavailable") return { label: "laag", reason: "niet beschikbaar" };
  if (!canMatch) return { label: "laag", reason: "profiel onvolledig" };
  if (score < 50) return { label: "laag", reason: "lage match-score" };
  if (score >= 80 && s.availability === "available") return { label: "hoog", reason: null };
  const reason =
    !s.availability || s.availability === "unknown"
      ? "beschikbaarheid onbekend"
      : s.completeness && s.completeness.score < 80
        ? "profiel onvolledig"
        : null;
  return { label: "midden", reason };
}
