/**
 * Read-only rendering of the notes/kennis blob on a chef- or klant-profiel.
 *
 * The injected ShiftManager knowledge (dated communicatie cards, favorieten/blacklist
 * met redenen, briefings, uren-historie) lives in chefs.notes / clients.notes. Before
 * this card the ONLY rendering was a 4-row <textarea> at the bottom of the edit form —
 * the audit's top finding: the richest data in the system was invisible. This card puts
 * it high on the page, read-first; editing stays in the Bewerken-form below.
 *
 * Server component, no client JS: long blobs collapse behind a native <details>.
 */

const PREVIEW_LINES = 10;

export function KnowledgeNotesCard({ notes, editHref }: { notes: string | null; editHref?: string }) {
  const text = notes?.trim();
  if (!text) return null;

  const lines = text.split("\n");
  const preview = lines.slice(0, PREVIEW_LINES).join("\n");
  const rest = lines.slice(PREVIEW_LINES).join("\n").trim();

  return (
    <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy">
          Kennis &amp; notities
        </h2>
        {editHref ? (
          <a href={editHref} className="font-ui text-[10px] uppercase tracking-[0.14em] text-ink-400 hover:text-burgundy">
            Bewerken ↓
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Alles wat we over deze relatie weten — inclusief de historie uit het oude systeem. Alleen intern.
      </p>
      <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-800">{preview}</div>
      {rest ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-burgundy hover:text-burgundy-900">
            Toon alles ({lines.length} regels)
          </summary>
          <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-800">{rest}</div>
        </details>
      ) : null}
    </section>
  );
}
