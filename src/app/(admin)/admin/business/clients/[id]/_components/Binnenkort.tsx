/**
 * "Binnenkort op deze pagina" — static roadmap card. Pure-presentational, no
 * data props; relocated verbatim from clients/[id]/page.tsx (JSX is
 * character-identical after whitespace normalization).
 */
export function Binnenkort() {
  return (
    <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Binnenkort op deze pagina</h2>
      <ul className="mt-3 space-y-2 text-sm text-ink-700">
        <li>· Plaatsings-geschiedenis (Phase 3)</li>
        <li>· Aankomende shifts (Phase 3)</li>
        <li>· Facturen + betalingsstatus (Phase 5)</li>
        <li>· Gegeven ratings</li>
      </ul>
    </div>
  );
}
