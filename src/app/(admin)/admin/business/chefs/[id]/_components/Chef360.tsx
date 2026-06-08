import Link from "next/link";

import { TrendTile } from "@/components/dashboard/TrendTile";
import { chefs } from "@/lib/db/schema";
import { clientTypeLabel } from "@/lib/domain/client-taxonomy";
import {
  getChefFeedbackSummary,
  getChefRecentShifts,
  getChefWorkSummary,
} from "@/lib/domain/chef-history";
import { buildChefTrends, type ChurnRisk } from "@/lib/domain/chef-trends";
import { getChefReliability } from "@/lib/chef-events";
import { listProfileDataRequests } from "@/lib/domain/profile-data-requests";
import {
  getOnboardingReadiness,
  getProfileCompleteness,
} from "@/lib/domain/profile-completeness";
import { RATING_TAG_LABELS, type RatingTag } from "@/lib/rating-tags";

type ChefRow = typeof chefs.$inferSelect;

const TRANSPORT_LABELS: Record<string, string> = {
  car: "Auto", motorbike: "Motor", ebike: "E-bike", none: "Geen (OV)",
};
const PREF_LABELS: Record<string, string> = {
  bbq: "BBQ", breakfast: "Ontbijt", banqueting: "Banqueting", beachclub: "Beachclub",
  early_shifts: "Vroege diensten", hotels: "Hotels", restaurants: "Restaurants",
  michelin: "Michelin", flexible: "Flexibel",
};
const REQ_STATUS_LABELS: Record<string, string> = {
  draft: "concept", sent: "verzonden", completed: "ingevuld", expired: "verlopen", failed: "mislukt",
};

/**
 * Chef 360 — the full track record, shown below the InzetbaarheidCard verdict.
 * Largely presentational but holds ONE embedded form (the "vraag ontbrekende
 * gegevens" request), so `doRequestData` stays in page.tsx (it closes over the route
 * `id`) and arrives as a prop. The onboarding/profiel checklists and the recente-
 * diensten list are collapsed behind <details> to cut information overload — the
 * verdict card above already surfaces deployability and what's missing, with the
 * two completeness scores echoed on the collapsed summary bar.
 */
export function Chef360({
  chef,
  onboarding,
  hasIdFront,
  hasIdBack,
  completeness,
  dataRequests,
  workSummary,
  feedback,
  recentShifts,
  reliability,
  trends,
  doRequestData,
}: {
  chef: ChefRow;
  onboarding: ReturnType<typeof getOnboardingReadiness>;
  hasIdFront: boolean;
  hasIdBack: boolean;
  completeness: ReturnType<typeof getProfileCompleteness>;
  dataRequests: Awaited<ReturnType<typeof listProfileDataRequests>>;
  workSummary: Awaited<ReturnType<typeof getChefWorkSummary>>;
  feedback: Awaited<ReturnType<typeof getChefFeedbackSummary>>;
  recentShifts: Awaited<ReturnType<typeof getChefRecentShifts>>;
  reliability: Awaited<ReturnType<typeof getChefReliability>>;
  trends: ReturnType<typeof buildChefTrends>;
  doRequestData: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Chef 360 — staat van dienst
      </h2>

      {/* Onboarding + profiel checklists — collapsed by default to cut the info
          wall. The verdict card at the top already surfaces what's missing; the two
          completeness scores stay on the summary bar so nothing is hidden at a glance. */}
      <details className="mt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2.5 hover:bg-bg-gray/40">
          <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Onboarding &amp; profiel — checklist &amp; gegevensverzoeken
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`rounded-full px-2 py-0.5 ${
                onboarding.ready
                  ? "bg-emerald-100 text-emerald-700"
                  : onboarding.score >= 60
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              onb. {onboarding.score}%
            </span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                completeness.score >= 80
                  ? "bg-emerald-100 text-emerald-700"
                  : completeness.score >= 55
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              prof. {completeness.score}%
            </span>
            <span className="text-ink-400">▾</span>
          </span>
        </summary>

      {/* PR-KPI: onboarding readiness (payroll/identity data) */}
      <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Onboarding &amp; uitbetaalgegevens
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              onboarding.ready
                ? "bg-emerald-100 text-emerald-700"
                : onboarding.score >= 60
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-700"
            }`}
          >
            {chef.onboardingStatus === "submitted"
              ? "Ingediend"
              : chef.onboardingStatus === "in_progress"
                ? "Bezig"
                : "Niet gestart"}{" "}
            · {onboarding.score}%
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {[
            { label: "Naam", ok: !!(chef.firstName && chef.surname) },
            { label: "Geb.datum", ok: !!chef.dateOfBirth },
            { label: "Adres", ok: !!(chef.street && chef.postcode) },
            { label: "BSN", ok: !!chef.bsnEncrypted },
            { label: "IBAN", ok: !!chef.ibanEncrypted },
            { label: "Rekeninghouder", ok: !!chef.bankAccountHolderName },
            { label: "ID-nr", ok: !!chef.idNumberEncrypted },
            { label: "ID-kopie", ok: hasIdFront && hasIdBack },
            { label: "Dienstverband", ok: !!chef.employmentType },
          ].map((c) => (
            <span
              key={c.label}
              className={`rounded-full px-2 py-0.5 ${c.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
            >
              {c.ok ? "✓" : "✗"} {c.label}
            </span>
          ))}
        </div>
        {onboarding.missingCritical.length > 0 ? (
          <p className="mt-1.5 text-[11px] text-amber-700">Mist: {onboarding.missingCritical.join(", ")}</p>
        ) : (
          <p className="mt-1.5 text-[11px] text-emerald-700">✓ Klaar voor inplannen en uitbetaling.</p>
        )}
        {onboarding.idExpired ? (
          <p className="mt-1 text-[11px] text-red-700">⚠ ID-bewijs is verlopen.</p>
        ) : onboarding.idExpiringSoon ? (
          <p className="mt-1 text-[11px] text-amber-700">
            ID-bewijs verloopt binnenkort
            {chef.idExpiresAt ? ` (${new Date(chef.idExpiresAt).toLocaleDateString("nl-NL")})` : ""}.
          </p>
        ) : null}
      </div>

      {/* PR-2: profiel & voorkeuren (uit Jotform) */}
      <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Profiel & voorkeuren</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              completeness.score >= 80
                ? "bg-emerald-100 text-emerald-700"
                : completeness.score >= 55
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-700"
            }`}
          >
            profiel {completeness.score}% · {completeness.label}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chef.transportMode && (
            <span className="rounded-full bg-burgundy/5 px-2 py-0.5 text-xs text-burgundy">
              {TRANSPORT_LABELS[chef.transportMode] ?? chef.transportMode}
            </span>
          )}
          {(chef.preferences ?? []).map((p) => (
            <span key={p} className="rounded-full bg-bg-gray px-2 py-0.5 text-xs text-ink-700">
              {PREF_LABELS[p] ?? p}
            </span>
          ))}
          {chef.employmentType && (
            <span className="rounded-full bg-bg-gray px-2 py-0.5 text-xs text-ink-700">
              {chef.employmentType.toUpperCase()}
            </span>
          )}
          {!chef.transportMode && (chef.preferences ?? []).length === 0 && (
            <span className="text-xs text-ink-500">Nog niet uit Jotform overgenomen.</span>
          )}
        </div>
        {(chef.street || chef.postcode) && (
          <p className="mt-2 text-xs text-ink-500">
            {[chef.street, chef.houseNumber].filter(Boolean).join(" ")}
            {chef.postcode ? `, ${chef.postcode}` : ""}
            {chef.city ? ` ${chef.city}` : ""}
          </p>
        )}
        {completeness.missingCritical.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-700">Mist: {completeness.missingCritical.join(", ")}</p>
        )}
        {(completeness.missingCritical.length > 0 || completeness.score < 80) && (
          <form action={doRequestData} className="mt-3">
            <input
              type="hidden"
              name="fields"
              value={[...completeness.missingCritical, ...completeness.missingNiceToHave].join(",")}
            />
            <button
              type="submit"
              className="rounded-full border border-burgundy/40 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
            >
              Vraag ontbrekende gegevens (e-mail)
            </button>
          </form>
        )}
        {dataRequests.length > 0 && (
          <div className="mt-3 border-t border-ink-100 pt-2">
            <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Verzoeken</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-700">
              {dataRequests.map((rq) => (
                <li key={rq.id}>
                  {rq.requestType} · {rq.channel} ·{" "}
                  <span
                    className={
                      rq.status === "completed"
                        ? "text-emerald-700"
                        : rq.status === "failed"
                          ? "text-red-700"
                          : "text-ink-500"
                    }
                  >
                    {REQ_STATUS_LABELS[rq.status] ?? rq.status}
                  </span>
                  {rq.sentAt ? ` · ${fmtNlDate(rq.sentAt)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      </details>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Snap label="Uren gewerkt" value={`${workSummary.totalHoursWorked} u`} note="goedgekeurd" />
        <Snap
          label="Diensten afgerond"
          value={String(workSummary.completedShifts)}
          note={workSummary.upcomingShifts > 0 ? `${workSummary.upcomingShifts} gepland` : undefined}
        />
        <Snap
          label="Beoordeling"
          value={workSummary.averageRating != null ? `${workSummary.averageRating.toFixed(1)}★` : "—"}
          note={workSummary.ratingCount > 0 ? `${workSummary.ratingCount} reviews` : "geen reviews"}
        />
        <Snap
          label="Laatst gewerkt"
          value={workSummary.lastWorkedAt ? fmtNlDate(workSummary.lastWorkedAt) : "—"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Rel label="Geaccepteerd" n={workSummary.acceptedCount} />
        <Rel label="Geweigerd" n={workSummary.declinedCount} />
        <Rel label="Geannuleerd" n={workSummary.cancelledCount} tone={workSummary.cancelledCount > 0 ? "amber" : undefined} />
        <Rel label="No-show" n={workSummary.noShowCount} tone={workSummary.noShowCount > 0 ? "red" : undefined} />
      </div>
      <p className="mt-1 text-[10px] text-ink-500">
        Uren uit goedgekeurde urenstaten · betrouwbaarheid uit plaatsingen · beoordelingen uit klantfeedback.
      </p>

      {reliability.totalEvents > 0 ? (
        <div className="mt-3">
          <p className="mb-1 font-ui text-[10px] font-medium uppercase tracking-wider text-ink-500">
            Gedrag · uit activiteitslog ({reliability.totalEvents})
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
              Acceptatie:{" "}
              <b className="text-ink-900">
                {reliability.acceptanceRate != null
                  ? `${Math.round(reliability.acceptanceRate * 100)}%`
                  : "—"}
              </b>
              {reliability.proposalsAccepted + reliability.proposalsRejected > 0 ? (
                <span className="text-ink-400">
                  {" "}
                  ({reliability.proposalsAccepted}/
                  {reliability.proposalsAccepted + reliability.proposalsRejected})
                </span>
              ) : null}
            </span>
            <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
              Reactietijd:{" "}
              <b className="text-ink-900">
                {reliability.avgResponseMinutes != null ? `${reliability.avgResponseMinutes} min` : "—"}
              </b>
            </span>
            <span
              className={`rounded-full px-2.5 py-1 ${reliability.cancellations > 0 ? "bg-red-50 text-red-700" : "bg-bg-gray text-ink-700"}`}
            >
              Zelf geannuleerd: <b>{reliability.cancellations}</b>
            </span>
            <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
              Laatste activiteit:{" "}
              <b className="text-ink-900">
                {reliability.lastActivityAt ? fmtNlDate(reliability.lastActivityAt) : "—"}
              </b>
            </span>
          </div>
        </div>
      ) : null}

      {/* KPI-2: 8-week trend — sparklines + noise-guarded deltas + honest churn signal */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-ui text-[10px] font-medium uppercase tracking-wider text-ink-500">
            Trend · laatste 8 weken
          </p>
          <ChurnChip churn={trends.churn} />
        </div>
        {trends.hasEnoughHistory ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrendTile label="Uren" spark={trends.hoursSparkline} value={`${trends.hoursDelta.thisPeriod} u`} delta={trends.hoursDelta} />
            <TrendTile label="Marge" spark={trends.marginSparkline} value={`€ ${trends.marginDelta.thisPeriod}`} delta={trends.marginDelta} />
            <TrendTile label="Diensten" spark={trends.shiftsSparkline} value={String(trends.shiftsDelta.thisPeriod)} delta={trends.shiftsDelta} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-ink-200 bg-bg-gray/40 px-3 py-2 text-xs text-ink-500">
            Te weinig historie voor een trend — vanaf ±2 weken activiteit verschijnt hier de 8-weekse grafiek.
          </p>
        )}
        <p className="mt-1 text-[10px] text-ink-500">
          Per week opgeteld uit de dagelijkse snapshot · deze week vs. vorige · ▲▼ alleen bij een betekenisvolle basis (ruisfilter).
        </p>
      </div>

      {(workSummary.topClients.length > 0 ||
        workSummary.topSegments.length > 0 ||
        workSummary.topClientTypes.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {workSummary.topClients.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Meeste ervaring bij</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-900">
                {workSummary.topClients.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-ink-500">{c.count}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {workSummary.topSegments.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Sterk in</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {workSummary.topSegments.map((s) => (
                  <span key={s.segment} className="rounded-full bg-burgundy/5 px-2 py-0.5 text-xs text-burgundy">
                    {s.segment} · {s.count}×
                  </span>
                ))}
              </div>
            </div>
          )}
          {workSummary.topClientTypes.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Werkt vooral voor</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {workSummary.topClientTypes.map((t) => (
                  <span key={t.clientType} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                    {clientTypeLabel(t.clientType)} · {t.count}×
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Wat klanten zeggen</p>
        {feedback.topTags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-ink-500">Meest genoemd:</span>
            {feedback.topTags.map((t) => (
              <span key={t.tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                {RATING_TAG_LABELS[t.tag as RatingTag] ?? t.tag} ({t.count})
              </span>
            ))}
          </div>
        )}
        {feedback.recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nog geen beoordelingen.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {feedback.recent.map((f, i) => (
              <li key={i} className="border-t border-ink-100 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between">
                  <span className="text-amber-500">
                    {"★".repeat(f.stars)}
                    <span className="text-ink-200">{"★".repeat(5 - f.stars)}</span>
                  </span>
                  <span className="text-[11px] text-ink-500">{f.clientName ?? "Klant"} · {fmtNlDate(f.createdAt)}</span>
                </div>
                {f.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.tags.map((t) => (
                      <span key={t} className="rounded bg-bg-gray px-1.5 py-0.5 text-[10px] text-ink-700">
                        {RATING_TAG_LABELS[t as RatingTag] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                {f.comment && <p className="mt-1 text-sm text-ink-700">&ldquo;{f.comment}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
          <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Recente diensten
          </span>
          <span className="text-ink-400">▾</span>
        </summary>
        {recentShifts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nog geen plaatsingen.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recentShifts.map((s) => (
              <li key={s.shiftId}>
                <Link
                  href={`/admin/business/shifts/${s.shiftId}`}
                  className="flex flex-wrap items-center gap-x-2 text-sm hover:text-burgundy"
                >
                  <span className="text-ink-500">{fmtNlDate(s.startsAt)}</span>
                  <span className="text-ink-900">{s.clientName ?? "Onbekende klant"}</span>
                  <span className="text-ink-500">· {s.roleNeeded}{s.city ? ` · ${s.city}` : ""}</span>
                  <span className="ml-auto rounded-full bg-bg-gray px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                    {s.placementStatus}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

/* ----- helpers (relocated verbatim from page.tsx — Chef-360-scoped) ----- */

function fmtNlDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const CHURN_STYLE: Record<Exclude<ChurnRisk["level"], "none">, { cls: string; label: string }> = {
  low: { cls: "bg-bg-gray text-ink-600", label: "Actief" },
  watch: { cls: "bg-amber-100 text-amber-800", label: "Let op" },
  elevated: { cls: "bg-red-100 text-red-700", label: "Risico" },
};

function ChurnChip({ churn }: { churn: ChurnRisk }) {
  if (churn.level === "none") return null;
  const s = CHURN_STYLE[churn.level];
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[11px] ${s.cls}`}
      title={churn.reasons.join(" · ")}
    >
      {s.label} · {churn.reasons[0]}
    </span>
  );
}

function Snap({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink-900">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-ink-500">{note}</p>}
    </div>
  );
}

function Rel({ label, n, tone }: { label: string; n: number; tone?: "amber" | "red" }) {
  const cls =
    tone === "red"
      ? "bg-red-100 text-red-700"
      : tone === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-bg-gray text-ink-700";
  return (
    <span className={`rounded-full px-2.5 py-1 font-ui text-[11px] ${cls}`}>
      {label}: <strong>{n}</strong>
    </span>
  );
}
