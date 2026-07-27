/**
 * Helpers over the notes blob (chefs.notes / clients.notes) that carries the injected
 * oude-systeem kennis. Pure string work — deliberately in src/lib (NOT src/lib/ai) so
 * the CI ai-eval gate does not trigger on it.
 */

/**
 * The most recent dated note line from the blob, stripped of its "• 2025-10-22 (Helena): "
 * prefix — the injected blocks list notes newest-first. Used as a "voor je belt" fallback
 * headline when the new system's intel/patterns are still empty.
 */
export function latestLegacyNoteLine(notes: string | null | undefined, maxLen = 160): string | null {
  if (!notes) return null;
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    // chef format: "• 2025-10-22 (Helena): tekst"
    let text = line.match(/^[•*]\s*\d{4}-\d{2}-\d{2}\s*\(([^)]*)\):\s*(.+)$/)?.[2];
    // klant format: "• 0 | 08/07/2026 | Evaluatie | tekst" (type-segment soms afwezig)
    if (!text && /^[•*]\s*\d+\s*\|\s*\d{2}\/\d{2}\/\d{4}\s*\|/.test(line)) {
      const parts = line.split("|").map((p) => p.trim());
      text = parts[parts.length - 1];
    }
    if (!text?.trim()) continue;
    text = text.trim();
    return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
  }
  // No dated notes, but there IS an oude-systeem stats line (22 chefs in prod have
  // stats without communicatie) → still better than "Nog weinig bekend".
  const h = legacyHistory(notes);
  if (h) return `±${h.hours} uur gewerkt in het oude systeem (${h.invites} uitnodigingen).`;
  return null;
}

/**
 * The "±1149 uur gewerkt" history line the injection wrote per chef, parsed back out so
 * UI surfaces (ChefCard) can show real tenure instead of calling a veteran "nieuw".
 */
export function legacyHistory(notes: string | null | undefined): { invites: number; hours: number } | null {
  if (!notes) return null;
  const m = notes.match(/Historie oud systeem:\s*(\d+)\s*uitnodigingen\s*·\s*±(\d+)\s*uur gewerkt/);
  if (!m) return null;
  return { invites: Number(m[1]), hours: Number(m[2]) };
}
