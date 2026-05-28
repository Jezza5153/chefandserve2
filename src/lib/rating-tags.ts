/**
 * Rating tag vocabulary (PR-KLANT-5).
 *
 * A versioned constant (not a DB enum) so admin can extend it without a
 * migration. Tags are SOFT matching hints. Negative tags require human
 * review before they penalize a chef (see docs/ai/ai-safety-rules.md).
 *
 * Copy is always "feedback", never "review"/"beoordeling"/"score".
 */

export const POSITIVE_TAGS = [
  "punctueel",
  "communicatie_goed",
  "past_bij_team",
  "werkt_netjes",
  "tempo_goed",
  "zelfstandig",
  "kwaliteit_eten",
  "zou_opnieuw_boeken",
] as const;

export const NEGATIVE_TAGS = [
  "te_laat",
  "communicatie_kon_beter",
  "tempo_te_langzaam",
] as const;

export const RATING_TAGS = [...POSITIVE_TAGS, ...NEGATIVE_TAGS] as const;

export type RatingTag = (typeof RATING_TAGS)[number];

export const RATING_TAG_LABELS: Record<RatingTag, string> = {
  punctueel: "Punctueel",
  communicatie_goed: "Goede communicatie",
  past_bij_team: "Past bij team",
  werkt_netjes: "Werkt netjes",
  tempo_goed: "Tempo goed",
  zelfstandig: "Zelfstandig",
  kwaliteit_eten: "Kwaliteit eten",
  zou_opnieuw_boeken: "Zou opnieuw boeken",
  te_laat: "Te laat",
  communicatie_kon_beter: "Communicatie kon beter",
  tempo_te_langzaam: "Tempo te langzaam",
};

const TAG_SET: ReadonlySet<string> = new Set(RATING_TAGS);

/** Keep only known tags (drops anything a client tried to inject). */
export function sanitizeTags(input: string[]): RatingTag[] {
  const seen = new Set<string>();
  const out: RatingTag[] = [];
  for (const t of input) {
    if (TAG_SET.has(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t as RatingTag);
    }
  }
  return out;
}

/** Minimum ratings before a chef may see their own average (anti-demoralizing). */
export const CHEF_AVERAGE_MIN_COUNT = 5;
