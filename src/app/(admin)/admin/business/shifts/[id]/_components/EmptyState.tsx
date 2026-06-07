/**
 * "Geen geschikte chefs gevonden" empty state — pure presentational.
 * Relocated verbatim from shifts/[id]/page.tsx. The surrounding
 * `matches.length === 0 && existingPlacements.length === 0` guard stays in the
 * page; only the inner block lives here.
 */
export function EmptyState() {
  return (
    <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
      <p className="font-serif text-xl text-ink-900">
        Geen geschikte chefs gevonden
      </p>
      <p className="mt-2 text-sm text-ink-500">
        Voeg meer chefs toe of pas de shift-criteria aan.
      </p>
    </div>
  );
}
