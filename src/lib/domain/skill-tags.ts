/**
 * CHEF-PR5 — skill / requirement tag taxonomy.
 *
 * One curated, controlled vocabulary shared by BOTH sides of matching:
 *   - a chef self-selects which tags they can do  (chefs.skillTags)
 *   - a client's requirement tags                  (clients.clientTags, today
 *     admin-managed; a structured must/nice editor is a noted follow-up)
 *
 * Controlled keys (not free text) so matching + the AI can reason over them.
 * The matcher SOFT-scores chef skillTags ∩ client requirement tags — when both
 * sides use this vocabulary the overlap is a real signal; when they don't, it's
 * simply a no-op (never a hard exclude). Labels are Dutch (chef-facing).
 */
export type SkillTagCategory = "keuken" | "gelegenheid" | "dieet_veiligheid" | "service";

export type SkillTag = {
  key: string;
  label: string;
  category: SkillTagCategory;
};

export const SKILL_TAG_CATEGORIES: Record<SkillTagCategory, string> = {
  keuken: "Keuken & technieken",
  gelegenheid: "Soort gelegenheid",
  dieet_veiligheid: "Diëten & veiligheid",
  service: "Service & rollen",
};

/** The vocabulary. Keys are stable lowercase snake_case — never rename, only append. */
export const SKILL_TAGS: SkillTag[] = [
  // Keuken & technieken
  { key: "fine_dining", label: "Fine dining", category: "keuken" },
  { key: "a_la_carte", label: "À la carte", category: "keuken" },
  { key: "patisserie", label: "Patisserie", category: "keuken" },
  { key: "grill", label: "Grill / bakkerij", category: "keuken" },
  { key: "koude_keuken", label: "Koude keuken / garde manger", category: "keuken" },
  { key: "sauzen", label: "Sauzen / saucier", category: "keuken" },
  { key: "wereldkeuken", label: "Wereldkeuken", category: "keuken" },
  // Soort gelegenheid
  { key: "banqueting", label: "Banqueting", category: "gelegenheid" },
  { key: "events", label: "Events / catering", category: "gelegenheid" },
  { key: "hotel", label: "Hotel", category: "gelegenheid" },
  { key: "ontbijt", label: "Ontbijt", category: "gelegenheid" },
  { key: "zorg", label: "Zorg / instelling", category: "gelegenheid" },
  { key: "hoog_volume", label: "Hoog volume", category: "gelegenheid" },
  // Diëten & veiligheid
  { key: "allergenen", label: "Allergenen / HACCP", category: "dieet_veiligheid" },
  { key: "halal", label: "Halal", category: "dieet_veiligheid" },
  { key: "vegan_vegetarisch", label: "Vegan / vegetarisch", category: "dieet_veiligheid" },
  { key: "medische_dieten", label: "Medische diëten", category: "dieet_veiligheid" },
  // Service & rollen
  { key: "leidinggevend", label: "Leidinggevend / sous", category: "service" },
  { key: "gastvrijheid", label: "Gastcontact / pass", category: "service" },
  { key: "wijn_pairing", label: "Wijn-pairing", category: "service" },
];

const VALID = new Set(SKILL_TAGS.map((t) => t.key));
const LABELS: Record<string, string> = Object.fromEntries(SKILL_TAGS.map((t) => [t.key, t.label]));

/** Keep only keys that exist in the vocabulary (drop free text / stale keys). */
export function sanitizeSkillTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const k = String(t).trim().toLowerCase();
    if (VALID.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Dutch label for a key (falls back to the key itself). */
export function skillTagLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** SKILL_TAGS grouped by category, for rendering the picker. */
export function skillTagsByCategory(): Array<{ category: SkillTagCategory; label: string; tags: SkillTag[] }> {
  return (Object.keys(SKILL_TAG_CATEGORIES) as SkillTagCategory[]).map((category) => ({
    category,
    label: SKILL_TAG_CATEGORIES[category],
    tags: SKILL_TAGS.filter((t) => t.category === category),
  }));
}

/**
 * Case-insensitive overlap between a chef's skill tags and a client's requirement
 * tags (the client side is free-form today, so we normalise + match on key).
 * Returns the matched chef-tag keys (for a klant-safe "matcht: …" reason).
 */
export function skillTagOverlap(
  chefTags: readonly string[] | null | undefined,
  requirementTags: readonly string[] | null | undefined,
): string[] {
  const chefKeys = sanitizeSkillTags(chefTags);
  if (chefKeys.length === 0 || !requirementTags?.length) return [];
  const want = new Set(requirementTags.map((t) => String(t).trim().toLowerCase()));
  return chefKeys.filter((k) => want.has(k));
}
