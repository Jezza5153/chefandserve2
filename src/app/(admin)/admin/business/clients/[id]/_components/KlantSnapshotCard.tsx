/**
 * "Voor je belt/verkoopt" — the before-you-call glance for a KLANT. One composed,
 * read-only summary from getClientIntelSnapshot (Maarten's brein + derived booking
 * patterns). Answers "wie is deze klant + wat stuur ik + waar let ik op?" at the top
 * of the profile, so Maarten is a step ahead without reading the rest.
 */
import type { ClientIntelSnapshot } from "@/lib/domain/intel";
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

export function KlantSnapshotCard({ snapshot }: { snapshot: ClientIntelSnapshot }) {
  const { brein, patterns } = snapshot;
  const topRole = patterns.roleMix[0];
  const repeatChef = patterns.repeatChefs[0];
  const bestChefType = brein?.bestChefType?.trim();
  const caresAbout = brein?.caresAbout?.trim();
  const hiddenRisk = brein?.hiddenRisk?.trim();
  const nextAction = brein?.nextBestAction?.trim();

  const facts: string[] = [];
  if (patterns.busiestDayLabel) {
    facts.push(`boekt vaak ${FULL_DAY[patterns.busiestDayLabel] ?? patterns.busiestDayLabel}`);
  }
  if (topRole) facts.push(`meestal ${formatChefRole(topRole.role)}`);
  if (repeatChef) facts.push(`vaste chef: ${repeatChef.name}`);

  const headline = bestChefType
    ? `Stuur: ${bestChefType}`
    : facts.length > 0
      ? cap(facts[0])
      : null;

  return (
    <section className="rounded-lg border border-burgundy/20 bg-burgundy/[0.03] p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Voor je belt</p>
      {headline ? (
        <p className="mt-1.5 font-serif text-lg text-ink-900">{headline}</p>
      ) : (
        <p className="mt-1.5 text-sm text-ink-500">
          Nog weinig bekend — vul &ldquo;Maarten&rsquo;s brein&rdquo; in of laat de klant eerst
          boeken.
        </p>
      )}
      {facts.length > 0 ? <p className="mt-1 text-sm text-ink-600">{facts.join(" · ")}.</p> : null}

      {caresAbout || hiddenRisk || nextAction ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {caresAbout ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              let op: {caresAbout}
            </span>
          ) : null}
          {hiddenRisk ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              ⚠ {hiddenRisk}
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
