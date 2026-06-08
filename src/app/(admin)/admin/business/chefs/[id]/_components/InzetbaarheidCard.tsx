import type { InzetbaarheidVerdict } from "@/lib/domain/chef-inzetbaarheid";

/**
 * Inzetbaarheidskaart — the top-of-page "kan deze chef de vloer op?" verdict.
 *
 * Answers the operator's #1 question at a glance (verdict + the exact blockers),
 * and consolidates the actions that used to be scattered down the page (portal
 * invite/activate, mail, bel, spring-naar-bewerken). The verdict itself is computed
 * by the pure `computeChefInzetbaarheid` (smoke-tested); this component only renders.
 *
 * ACTION-BEARING: `doInviteAndActivate` / `doActivatePortal` close over the route
 * `id` in page.tsx and arrive as props (the established action-as-prop pattern).
 */

type PortalStatus = "none" | "invited" | "active" | "other";

const TONE: Record<
  InzetbaarheidVerdict["level"],
  { card: string; dot: string; title: string }
> = {
  ready: {
    card: "border-emerald-300 bg-emerald-50/60",
    dot: "bg-emerald-500",
    title: "text-emerald-900",
  },
  almost: {
    card: "border-amber-300 bg-amber-50/60",
    dot: "bg-amber-500",
    title: "text-amber-900",
  },
  blocked: {
    card: "border-red-300 bg-red-50/60",
    dot: "bg-red-500",
    title: "text-red-900",
  },
};

function fmtNlDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

export function InzetbaarheidCard({
  verdict,
  rating,
  ratingCount,
  noShowCount,
  cancelledCount,
  lastWorkedAt,
  upcomingShifts,
  email,
  phone,
  portalStatus,
  doInviteAndActivate,
  doActivatePortal,
}: {
  verdict: InzetbaarheidVerdict;
  rating: number | null;
  ratingCount: number;
  noShowCount: number;
  cancelledCount: number;
  lastWorkedAt: Date | string | null;
  upcomingShifts: number;
  email: string | null;
  phone: string | null;
  portalStatus: PortalStatus;
  doInviteAndActivate: () => Promise<void>;
  doActivatePortal: () => Promise<void>;
}) {
  const tone = TONE[verdict.level];

  return (
    <section className={`mt-4 rounded-xl border p-5 ${tone.card}`}>
      {/* Row 1 — verdict + reliability strapline */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Inzetbaarheid
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
            <h2 className={`font-serif text-xl ${tone.title}`}>{verdict.headline}</h2>
          </div>
          <p className="mt-0.5 text-sm text-ink-600">{verdict.summary}</p>
        </div>

        <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-right text-xs text-ink-600">
          <div>
            <dt className="sr-only">Beoordeling</dt>
            <dd>
              <span className="text-amber-500">★</span>{" "}
              <b className="text-ink-900">{rating != null ? rating.toFixed(1) : "—"}</b>
              {ratingCount > 0 ? <span className="text-ink-400"> ({ratingCount})</span> : null}
            </dd>
          </div>
          <div>
            <dt className="sr-only">No-shows</dt>
            <dd className={noShowCount > 0 ? "text-red-700" : ""}>
              <b>{noShowCount}</b> no-show{noShowCount === 1 ? "" : "s"}
            </dd>
          </div>
          {cancelledCount > 0 ? (
            <div>
              <dt className="sr-only">Geannuleerd</dt>
              <dd className="text-amber-700">
                <b>{cancelledCount}</b> geann.
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="sr-only">Laatst gewerkt</dt>
            <dd>laatst {lastWorkedAt ? fmtNlDate(lastWorkedAt) : "—"}</dd>
          </div>
          {upcomingShifts > 0 ? (
            <div>
              <dt className="sr-only">Gepland</dt>
              <dd className="text-burgundy">
                <b>{upcomingShifts}</b> gepland
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* Row 2 — blocker / warning chips */}
      {verdict.blockers.length > 0 || verdict.warnings.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {verdict.blockers.map((b) => (
            <span
              key={`b-${b}`}
              className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-800"
            >
              ✗ {b}
            </span>
          ))}
          {verdict.warnings.map((w) => (
            <span
              key={`w-${w}`}
              className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] text-amber-800"
            >
              ! {w}
            </span>
          ))}
        </div>
      ) : null}

      {/* Row 3 — consolidated action bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200/60 pt-3">
        {/* Portal: the #1 "why can't they log in" action lives right here */}
        {portalStatus === "none" ? (
          email ? (
            <form action={doInviteAndActivate}>
              <button
                type="submit"
                className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
              >
                Uitnodigen &amp; activeren
              </button>
            </form>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-[11px] text-amber-800">
              Vul eerst een e-mailadres in voor portaaltoegang
            </span>
          )
        ) : portalStatus === "invited" ? (
          <form action={doActivatePortal}>
            <button
              type="submit"
              className="rounded-full bg-emerald-600 px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-emerald-700"
            >
              Activeren (welkom-mail)
            </button>
          </form>
        ) : portalStatus === "active" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-wider text-emerald-700">
            ✓ Portaal actief
          </span>
        ) : (
          <span className="rounded-full bg-bg-gray px-3 py-1.5 font-ui text-[10px] uppercase tracking-wider text-ink-500">
            Portaal: geen toegang
          </span>
        )}

        {email ? (
          <a
            href={`mailto:${email}`}
            className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:bg-bg-gray"
          >
            ✉ Mail
          </a>
        ) : null}
        {phone ? (
          <a
            href={`tel:${phone.replace(/\s+/g, "")}`}
            className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:bg-bg-gray"
          >
            ✆ Bel
          </a>
        ) : null}
        <a
          href="#bewerken"
          className="ml-auto font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
        >
          Gegevens bewerken ↓
        </a>
      </div>
    </section>
  );
}
