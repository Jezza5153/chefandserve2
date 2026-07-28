/**
 * Wording for the difference between "nothing left to do" and "nothing there at all".
 *
 * Every forward-looking surface in this system was built while the agency's work still
 * lived in the old system, so all of them learned to render zero as good news:
 * `demand.forecast` said "de bezetting is rond 👍", the briefing said "Alle uren van de
 * afgelopen week zijn rond 👍", and both meant "we have no data". The old system booked
 * 381 diensten in the month one of those sentences claimed everything was under control.
 *
 * A zero has two very different meanings and the owner must never have to guess which one
 * he is looking at:
 *   - nothing left to do  → genuinely good, say so
 *   - nothing there       → say THAT, and say where the work probably is
 *
 * Deliberately outside `src/lib/ai/**`: the CI eval only triggers on that path and the
 * OpenAI account is out of quota, so a pure helper living there would burn a run for
 * nothing (see the ai-chat-shared-and-eval-path note).
 */

/** Is this a real zero, or an empty system? */
export type LegeStaat =
  /** There was work and it is all handled. */
  | "afgerond"
  /** There is work and some of it is still open. */
  | "loopt"
  /** Nothing is recorded here for this period at all. */
  | "leeg";

export function bepaalStaat({ totaal, open }: { totaal: number; open: number }): LegeStaat {
  if (totaal === 0) return "leeg";
  return open > 0 ? "loopt" : "afgerond";
}

/**
 * One sentence for an empty period, in the agency's own voice.
 *
 * `periode` goes straight into the sentence ("vandaag", "deze week", "de komende 6 weken"),
 * so pass it in a form that reads naturally after "er staat/staan".
 */
export function legeAgendaZin(periode: string, opties?: { verwijsNaarArchief?: boolean }): string {
  const kern = `Er staat voor ${periode} niets in dit systeem — dat is een lege agenda, geen goede bezetting.`;
  return opties?.verwijsNaarArchief === false
    ? kern
    : `${kern} De planning voor die periode staat waarschijnlijk nog in het oude systeem.`;
}

/**
 * The same distinction as a short label for a card or a table cell, where a full sentence
 * does not fit. Keep these three strings identical everywhere so the UI stays legible.
 */
export function legeStaatLabel(staat: LegeStaat): string {
  switch (staat) {
    case "leeg":
      return "niets gepland";
    case "afgerond":
      return "alles rond";
    case "loopt":
      return "loopt nog";
  }
}
