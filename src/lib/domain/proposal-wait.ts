/**
 * P4d "no-response timer" — turn the proposals already in flight on a shift (placements
 * with status 'proposed', awaiting a chef reply) into a human "wacht al X" read + a stale
 * flag + a next-step nudge. These chefs are EXCLUDED from the fill drawer's match list
 * (matching skips already-placed chefs), so without this the owner can't see what's
 * pending and may re-propose the same person. Pure: the caller does the query; this only
 * labels + thresholds. No side effects, no new data — read-only display of live state.
 */
export type PendingProposalInput = {
  chefId: string;
  chefName: string | null;
  proposedAt: Date | string;
  seenAt: Date | string | null;
};

export type PendingProposal = {
  chefId: string;
  chefName: string;
  waitMinutes: number;
  waitLabel: string; // "14 min" / "2 u 10 min"
  seen: boolean; // chef opened the offer (seenAt) but hasn't responded
  stale: boolean; // waited past the threshold without responding
};

export type PendingProposalsSummary = {
  proposals: PendingProposal[]; // oldest wait first — the queue to work top-down
  staleCount: number;
  nudge: string | null; // next-step nudge, only when something has gone stale
};

/**
 * The "no response" threshold scales with urgency: a shift starting in a few hours needs a
 * faster reaction than one days out. Mirrors the spine's escalation feel without a stored
 * ladder — it's derived from how close the start is.
 */
export function noResponseThresholdMin(hoursToStart: number): number {
  if (hoursToStart <= 4) return 10;
  if (hoursToStart <= 12) return 20;
  if (hoursToStart <= 48) return 45;
  return 120;
}

export function summarizePendingProposals(
  rows: PendingProposalInput[],
  opts: { now: number; thresholdMin: number },
): PendingProposalsSummary {
  const proposals: PendingProposal[] = rows.map((r) => {
    const waitMinutes = Math.floor(Math.max(opts.now - new Date(r.proposedAt).getTime(), 0) / 60_000);
    return {
      chefId: r.chefId,
      chefName: r.chefName ?? "Onbekende chef",
      waitMinutes,
      waitLabel: formatWait(waitMinutes),
      seen: r.seenAt != null,
      stale: waitMinutes >= opts.thresholdMin,
    };
  });
  proposals.sort((a, b) => b.waitMinutes - a.waitMinutes);
  const staleCount = proposals.filter((p) => p.stale).length;
  return { proposals, staleCount, nudge: staleCount > 0 ? buildNudge(proposals[0]) : null };
}

function buildNudge(oldest: PendingProposal): string {
  const seen = oldest.seen ? "gezien maar geen reactie" : "nog niet gezien";
  return `${oldest.chefName} wacht al ${oldest.waitLabel} (${seen}). Volgende stap: verbreed de zoektocht, start een belvolgorde of informeer de klant.`;
}

function formatWait(min: number): string {
  if (min < 1) return "net";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} u` : `${h} u ${m} min`;
}
