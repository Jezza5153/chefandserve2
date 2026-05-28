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
  availability?: Availability; // for the shift date (PR-4)
  workedHereCount?: number; // prior placements for this client
  lastContactDays?: number | null; // days since last contact_log
  completeness?: Completeness | null;
  // PR-3.1 ranking inputs:
  distanceKm?: number | null;
  marginTone?: "ok" | "low" | "negative" | null;
  isFavorite?: boolean;
  isBlocked?: boolean;
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

/* ----- PR-3.1: ranking + explanation ------------------------------------- */

/**
 * Composite rank score (deterministic). Blocked = -1 (excluded). Otherwise the
 * match score adjusted by the operator-relevant signals: nearby + available +
 * worked-here + favorite boost; far / unavailable / thin-margin penalty.
 */
export function getRankScore(s: CandidateSignals): number {
  if (s.isBlocked) return -1; // hard exclude
  let score = s.matchScore ?? 50;
  if (s.isFavorite) score += 12;
  if (s.availability === "available") score += 8;
  else if (s.availability === "unavailable") score -= 25;
  score += Math.min(s.workedHereCount ?? 0, 3) * 4; // up to +12
  if (s.marginTone === "low") score -= 8;
  else if (s.marginTone === "negative") score -= 25;
  if (typeof s.distanceKm === "number") {
    if (s.distanceKm > 40) score -= 10;
    else if (s.distanceKm > 25) score -= 5;
  }
  if (s.completeness && !s.completeness.canMatch) score -= 15;
  return score;
}

export type MatchExplanation = {
  confidence: Confidence;
  reasons: string[]; // why this chef
  warnings: string[]; // what's risky
  nextCheck: string[]; // what to verify before sending
};

/** Decision support — waarom deze chef · wat is onzeker · wat checken. */
export function getChefMatchExplanation(s: CandidateSignals): MatchExplanation {
  const reasons: string[] = [];
  if ((s.matchScore ?? 0) >= 80) reasons.push("sterke match");
  if (s.isFavorite) reasons.push("klant-favoriet");
  if ((s.workedHereCount ?? 0) > 0) reasons.push(`eerder hier (${s.workedHereCount}×)`);
  if (s.availability === "available") reasons.push("beschikbaar");
  if (typeof s.distanceKm === "number" && s.distanceKm <= 15) reasons.push(`dichtbij (${s.distanceKm} km)`);
  if (s.marginTone === "ok") reasons.push("gezonde marge");

  const warnings = getChefCandidateWarnings(s);
  if (s.marginTone === "negative") warnings.push("negatieve marge");
  else if (s.marginTone === "low") warnings.push("lage marge");
  if (typeof s.distanceKm === "number" && s.distanceKm > 40) warnings.push(`ver weg (${s.distanceKm} km)`);
  if (s.isBlocked) warnings.push("door klant geblokkeerd");

  const nextCheck: string[] = [];
  if (!s.availability || s.availability === "unknown") nextCheck.push("beschikbaarheid bevestigen");
  if (!(typeof s.rateCents === "number" && s.rateCents > 0)) nextCheck.push("tarief opvragen");
  if (s.completeness && s.completeness.missingCritical.length > 0) nextCheck.push("profiel aanvullen");

  return { confidence: getMatchConfidenceLabel(s), reasons, warnings, nextCheck };
}

/**
 * PR-5 "Waarom niet nr 1?" — deterministic, relative explanation. Given the
 * top-ranked candidate and another candidate, returns the 1–2 signals that make
 * the other rank lower. Honest comparison, no AI. Empty when there's no clear
 * gap (i.e. they're effectively tied on the operator-relevant signals).
 */
export function getRankGapReasons(top: CandidateSignals, other: CandidateSignals): string[] {
  const gap: string[] = [];

  if (top.availability === "available" && other.availability !== "available") {
    gap.push("nr 1 is beschikbaar");
  }
  if (top.isFavorite && !other.isFavorite) gap.push("nr 1 is klant-favoriet");

  const tw = top.workedHereCount ?? 0;
  const ow = other.workedHereCount ?? 0;
  if (tw > ow) gap.push(`nr 1 werkte hier vaker (${tw}× vs ${ow}×)`);

  if (
    typeof top.distanceKm === "number" &&
    typeof other.distanceKm === "number" &&
    other.distanceKm > top.distanceKm + 5
  ) {
    gap.push(`verder weg dan nr 1 (${other.distanceKm} vs ${top.distanceKm} km)`);
  }

  const marginRank = { ok: 2, low: 1, negative: 0 } as const;
  if (
    top.marginTone &&
    other.marginTone &&
    marginRank[other.marginTone] < marginRank[top.marginTone]
  ) {
    gap.push("lagere marge dan nr 1");
  }

  const tm = top.matchScore ?? 0;
  const om = other.matchScore ?? 0;
  if (tm > om + 5) gap.push(`lagere match-score (${om} vs ${tm})`);

  return gap.slice(0, 2);
}
