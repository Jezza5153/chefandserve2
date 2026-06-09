/**
 * "Voor je belt" — PR-INTEL-P2. The before-you-call glance: one composed,
 * read-only summary from getChefIntelSnapshot (Maarten's brein + derived patterns
 * + decline signals + reactivation). Answers "who is this + what do I do next?"
 * at the top of the profile, so Maarten is a step ahead without reading the rest.
 */
import type { ChefIntelSnapshot } from "@/lib/domain/intel";
import { formatChefRole } from "@/lib/labels";

const FULL_DAY: Record<string, string> = {
  Ma: "maandag",
  Di: "dinsdag",
  Wo: "woensdag",
  Do: "donderdag",
  Vr: "vrijdag",
  Za: "zaterdag",
  Zo: "zondag",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ChefSnapshotCard({ snapshot }: { snapshot: ChefIntelSnapshot }) {
  const { brein, patterns, declineSignals, daysSinceLastWorked } = snapshot;
  const topRole = patterns.roleMix[0];
  const topClient = patterns.clientEarnings[0];
  const reactivate = daysSinceLastWorked != null && daysSinceLastWorked >= 14;
  const nextAction = brein?.nextBestAction?.trim();

  const facts: string[] = [];
  if (topRole) facts.push(`meestal ${formatChefRole(topRole.role)}`);
  if (patterns.busiestDayLabel) {
    facts.push(`werkt vaak ${FULL_DAY[patterns.busiestDayLabel] ?? patterns.busiestDayLabel}`);
  }
  if (topClient) facts.push(`vooral bij ${topClient.name}`);
  if (declineSignals[0]) facts.push(`wijst vaak af: ${declineSignals[0].label.toLowerCase()}`);

  const headline = brein?.bestUsedFor?.trim() || (facts.length > 0 ? cap(facts[0]) : null);

  return (
    <section className="rounded-lg border border-burgundy/20 bg-burgundy/[0.03] p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Voor je belt</p>
      {headline ? (
        <p className="mt-1.5 font-serif text-lg text-ink-900">{headline}</p>
      ) : (
        <p className="mt-1.5 text-sm text-ink-500">
          Nog weinig bekend — vul &ldquo;Maarten&rsquo;s brein&rdquo; in of laat de chef eerst
          werken; de patronen vullen zich vanzelf.
        </p>
      )}
      {facts.length > 0 ? <p className="mt-1 text-sm text-ink-600">{facts.join(" · ")}.</p> : null}

      {reactivate || nextAction ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {reactivate ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              ⚡ {daysSinceLastWorked} dagen niet gewerkt — goed moment om te bellen
            </span>
          ) : null}
          {nextAction ? (
            <span className="rounded-full bg-burgundy/10 px-2.5 py-1 text-[11px] font-medium text-burgundy">
              → {nextAction}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
