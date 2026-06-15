import Link from "next/link";

import { eur, type MarginEstimate, type TravelEstimate } from "@/lib/domain/travel";
import {
  getChefCandidateBadges,
  getChefMatchExplanation,
  getMatchConfidenceLabel,
  getRankGapReasons,
  type CandidateSignals,
} from "@/lib/domain/staffing-intelligence";
import type { MatchResult } from "@/lib/domain/matching";
import type { DeployabilityGate } from "@/lib/domain/chef-deployability-gate";
import type { Chef, Shift } from "@/lib/db/schema";
import { formatChefRole } from "@/lib/labels";
import { OverrideDeployabilityBlock } from "@/components/OverrideDeployabilityBlock";

type TravelMargin = { t: TravelEstimate; margin: MarginEstimate } | null;

/** PR-INTEL-P6: captured chef×klant pair-memory, surfaced at the choice moment. */
export type PairIntelBadge = {
  note: string | null;
  wouldRehire: boolean | null;
  up: number;
  down: number;
};

/**
 * "Vul deze dienst — beste matches" ranked candidate list. Action-bearing: the
 * `propose`, `logContact` and `toggleClientChef` "use server" actions stay in
 * page.tsx and are passed in as props (same names). The ranking helpers
 * (`signalsFor` / `travelFor`) and the lookup maps close over heavy page-local
 * state, so they are computed in the page and passed in unchanged — every
 * closure variable keeps its original name so the moved JSX stays
 * character-identical. The `{matches.length > 0 && (...)}` guard stays in the
 * page.
 */
export function MatchSuggestions({
  matches,
  rankedMatches,
  chefById,
  signalsFor,
  travelFor,
  topSignals,
  shift,
  propose,
  logContact,
  toggleClientChef,
  pairIntelByChef,
  deployByChef,
}: {
  matches: MatchResult[];
  rankedMatches: MatchResult[];
  chefById: Map<string, Chef>;
  signalsFor: (chefId: string, score: number) => CandidateSignals;
  travelFor: (chefId: string) => TravelMargin;
  topSignals: CandidateSignals | null;
  shift: Shift;
  propose: (formData: FormData) => Promise<void>;
  logContact: (formData: FormData) => Promise<void>;
  toggleClientChef: (formData: FormData) => Promise<void>;
  pairIntelByChef: Map<string, PairIntelBadge>;
  /** P3a compliance gate per chef (flag-gated; empty Map when off → no change). */
  deployByChef?: Map<string, DeployabilityGate>;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-xl text-ink-900">
        Vul deze dienst — beste matches (top {matches.length})
      </h2>
      <p className="mt-2 text-sm text-ink-700">
        Gerankt op match × beschikbaarheid × afstand × marge × historie ·
        klant-favorieten boven, geblokkeerde chefs onderaan. Bestaande
        voorstellen zijn uitgesloten.
      </p>
      <ul className="mt-4 space-y-2">
        {rankedMatches.map((m, idx) => {
          const c = chefById.get(m.chef.id);
          const sig = signalsFor(m.chef.id, m.score);
          const conf = getMatchConfidenceLabel(sig);
          const expl = getChefMatchExplanation(sig);
          const badges = getChefCandidateBadges(sig);
          const allWarnings = [...new Set([...m.warnings, ...expl.warnings])];
          const gapReasons =
            idx > 0 && topSignals && !sig.isBlocked
              ? getRankGapReasons(topSignals, sig)
              : [];
          const phoneDigits = c?.phone?.replace(/\D/g, "") ?? "";
          const tm = travelFor(m.chef.id);
          // P3a compliance hard-gate (distinct from sig.isBlocked, which is klant-blocked).
          const compGate = deployByChef?.get(m.chef.id);
          const compBlocked = compGate?.deployable === false;
          return (
            <li
              key={m.chef.id}
              className={`rounded-lg border bg-white p-4 ${
                sig.isBlocked ? "border-red-300 bg-red-50/40" : "border-ink-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/business/chefs/${m.chef.id}`}
                      className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {m.chef.fullName}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${scoreTone(m.score)}`}>
                      {m.score}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${confTone(conf.label)}`}>
                      {conf.label}
                      {conf.reason ? ` · ${conf.reason}` : ""}
                    </span>
                    {sig.isFavorite && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                        ★ favoriet
                      </span>
                    )}
                    {sig.isBlocked && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider text-red-700">
                        ⊘ geblokkeerd
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {formatChefRole(m.chef.vakniveau)} · {m.chef.city ?? "—"}
                    {m.chef.yearsExperience ? ` · ${m.chef.yearsExperience}j ervaring` : ""}
                  </p>
                  {badges.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {badges.map((b, i) => (
                        <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeTone(b.tone)}`}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {tm && (
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        ≈ {eur(tm.t.costCents)} reis · {tm.t.km} km · {tm.t.basis}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          tm.margin.tone === "negative"
                            ? "bg-red-100 text-red-700"
                            : tm.margin.tone === "low"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        marge {eur(tm.margin.marginCents)}
                        {tm.margin.tone === "low" ? " (laag)" : tm.margin.tone === "negative" ? " (negatief)" : ""}
                      </span>
                    </div>
                  )}
                  <PairIntelLine intel={pairIntelByChef.get(m.chef.id)} />
                  {m.reasons.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1">
                      {m.reasons.map((r) => (
                        <li key={r} className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">✓ {r}</li>
                      ))}
                    </ul>
                  )}
                  {allWarnings.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {allWarnings.map((w) => (
                        <li key={w} className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                  {expl.nextCheck.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      <span className="font-medium text-ink-700">Checken:</span>{" "}
                      {expl.nextCheck.join(" · ")}
                    </p>
                  )}
                  {gapReasons.length > 0 && (
                    <p className="mt-1 text-[11px] text-ink-500">
                      <span className="font-medium text-ink-700">Waarom niet nr 1:</span>{" "}
                      {gapReasons.join(" · ")}
                    </p>
                  )}
                </div>
                {/* P3a: a compliance-blocked chef loses the one-click button → override panel below. */}
                {!compBlocked && (
                  <form action={propose}>
                    <input type="hidden" name="chefId" value={m.chef.id} />
                    <input type="hidden" name="matchScore" value={m.score} />
                    <button type="submit" className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900">
                      Voorstel
                    </button>
                  </form>
                )}
              </div>

              {/* P3a compliance hard-gate: blocked chef → red blocker chips + override-with-reason. */}
              {compBlocked && compGate && (
                <div className="mt-3">
                  <OverrideDeployabilityBlock
                    action={propose}
                    hidden={{ chefId: m.chef.id, matchScore: m.score }}
                    blockers={compGate.blockers}
                  />
                </div>
              )}
              {/* Contact actions (one-click + log) */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                {phoneDigits && (
                  <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">
                    App
                  </a>
                )}
                {c?.email && (
                  <a href={`mailto:${c.email}`} className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">
                    Mail
                  </a>
                )}
                <form action={logContact} className="flex items-center gap-1.5">
                  <input type="hidden" name="chefId" value={m.chef.id} />
                  <select name="outcome" className="rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700">
                    <option value="spoken">Gesproken</option>
                    <option value="no_answer">Geen gehoor</option>
                    <option value="callback_requested">Teruggebeld</option>
                    <option value="not_suitable">Niet passend</option>
                    <option value="note_only">Notitie</option>
                  </select>
                  <input name="note" placeholder="notitie" className="w-28 rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700" />
                  <button type="submit" className="rounded-full border border-burgundy/40 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5">
                    Log
                  </button>
                </form>
                {/* PR-2B: klant-favoriet / blokkeer toggle */}
                <div className="ml-auto flex items-center gap-1.5">
                  <form action={toggleClientChef}>
                    <input type="hidden" name="chefId" value={m.chef.id} />
                    <input type="hidden" name="clientId" value={shift.clientId} />
                    <input type="hidden" name="kind" value="favorite" />
                    <button
                      type="submit"
                      className={`rounded-full border px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${
                        sig.isFavorite
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-ink-200 bg-white text-ink-700 hover:border-emerald-300 hover:text-emerald-700"
                      }`}
                    >
                      {sig.isFavorite ? "★ favoriet" : "☆ favoriet"}
                    </button>
                  </form>
                  <form action={toggleClientChef}>
                    <input type="hidden" name="chefId" value={m.chef.id} />
                    <input type="hidden" name="clientId" value={shift.clientId} />
                    <input type="hidden" name="kind" value="blocked" />
                    <button
                      type="submit"
                      className={`rounded-full border px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${
                        sig.isBlocked
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-ink-200 bg-white text-ink-700 hover:border-red-300 hover:text-red-700"
                      }`}
                    >
                      {sig.isBlocked ? "⊘ geblokkeerd" : "⊘ blokkeer"}
                    </button>
                  </form>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** PR-INTEL-P6 — the captured pair-memory for this chef at this klant, compact. */
function PairIntelLine({ intel }: { intel: PairIntelBadge | undefined }) {
  if (!intel) return null;
  const { note, wouldRehire, up, down } = intel;
  if (up === 0 && down === 0 && wouldRehire === null && !note) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
      {up > 0 && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">👍 {up}</span>
      )}
      {down > 0 && (
        <span className="rounded-full bg-burgundy/5 px-2 py-0.5 text-burgundy">👎 {down}</span>
      )}
      {wouldRehire === true && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
          klant neemt weer
        </span>
      )}
      {wouldRehire === false && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          klant liever niet
        </span>
      )}
      {note && (
        <span
          title={note}
          className="max-w-[240px] truncate rounded-full bg-bg-cream px-2 py-0.5 italic text-ink-600"
        >
          &ldquo;{note}&rdquo;
        </span>
      )}
    </div>
  );
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 60) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-bg-gray text-ink-500";
}

function confTone(label: "hoog" | "midden" | "laag"): string {
  if (label === "hoog") return "bg-emerald-100 text-emerald-700";
  if (label === "midden") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

function badgeTone(tone: "green" | "amber" | "blue" | "grey" | "red"): string {
  const map = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-700",
    grey: "bg-bg-gray text-ink-600",
    red: "bg-red-100 text-red-700",
  } as const;
  return map[tone];
}
