/**
 * /admin/planning — PLANNER-1. The planner cockpit (owner + planner). A read-only
 * day-radar composed from planner-intel: intake queue, accepted-not-confirmed, open
 * slots in the next 48h / 7d, and match suggestions for the most urgent open shift.
 * Quick-actions deep-link only to planner-accessible pages (inbox / rooster / diensten);
 * Klanten + Uren stay owner-only and are intentionally absent.
 */
import Link from "next/link";

import { Icon } from "@/components/admin/icons";
import { OpsCard } from "@/components/dashboard/OpsCard";
import { getPlannerCockpit, getPlannerReport } from "@/lib/domain/planner-intel";
import { formatChefRole } from "@/lib/labels";
import { requireAnyRole } from "@/lib/permissions";

export const metadata = { title: "Planning", robots: { index: false } };
export const dynamic = "force-dynamic";

const fmtWhen = (d: Date) =>
  new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(d));

export default async function PlanningPage() {
  await requireAnyRole(["owner", "planner"]);
  const [c, report] = await Promise.all([getPlannerCockpit(), getPlannerReport()]);
  const d = report.intakeDelta;
  const intakeLine =
    d.mode === "arrow"
      ? d.dir === "flat"
        ? "gelijk aan vorige week"
        : `${d.dir === "up" ? "▲" : "▼"} ${Math.abs(d.diff)} vs vorige week`
      : d.mode === "plain"
        ? `vorige week: ${d.previous}`
        : "nieuw deze week";

  return (
    <div className="max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Planner</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Planning</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Je werkdag in één oogopslag — wat binnenkomt, wat bevestigd moet worden, en waar koks tekortkomen.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OpsCard
          icon="inbox"
          label="Intake"
          value={c.intake.total}
          href="/admin/business/inbox"
          cta="Naar inbox"
          badge={c.intake.total}
          lines={[{ text: `${c.intake.chefs} chef · ${c.intake.clients} klant`, tone: "muted" }]}
        />
        <OpsCard
          icon="clock"
          label="Te bevestigen"
          value={c.acceptedUnconfirmed}
          href="/admin/business/shifts"
          cta="Bevestigen"
          lines={[
            {
              text: "chef zei ja, wacht op bevestiging",
              tone: c.acceptedUnconfirmed > 0 ? "amber" : "muted",
            },
          ]}
        />
        <OpsCard
          icon="alert-triangle"
          label="Open · 48 uur"
          value={c.open48hSlots}
          href="/admin/business/roster?view=day"
          cta="Naar rooster"
          lines={[
            {
              text: `${c.open48h.length} diensten met open plekken`,
              tone: c.open48hSlots > 0 ? "red" : "emerald",
            },
          ]}
        />
        <OpsCard
          icon="calendar-days"
          label="Open · 7 dagen"
          value={c.open7dCount}
          href="/admin/business/shifts"
          cta="Diensten"
          lines={[{ text: "onderbezette diensten deze week", tone: "muted" }]}
        />
      </div>

      {/* PLANNER-2: mini-reporting — deterministic, noise-guarded */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <OpsCard
          icon="inbox"
          label="Intake · deze week"
          value={report.intakeThis7d}
          href="/admin/business/inbox"
          cta="Inbox"
          lines={[{ text: intakeLine, tone: "muted" }]}
        />
        <OpsCard
          icon="check-circle"
          label="Bezetting · 30 dagen"
          value={report.fillRate30d != null ? `${Math.round(report.fillRate30d * 100)}%` : "—"}
          href="/admin/business/roster?view=week"
          cta="Rooster"
          lines={[{ text: `${report.fillFilled}/${report.fillSlots} plekken bevestigd`, tone: "muted" }]}
        />
        <OpsCard
          icon="clock"
          label="Mediane reactietijd"
          value={report.medianResponseMin != null ? `${report.medianResponseMin} min` : "—"}
          href="/admin/business/chefs"
          cta="Chefs"
          lines={[{ text: "chef-reactie op voorstellen (30d)", tone: "muted" }]}
        />
      </div>

      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Kritiek · komende 48 uur</h2>
        {c.open48h.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Alles bezet voor de komende 48 uur.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {c.open48h.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">
                    {s.clientName ?? "—"} · {formatChefRole(s.roleNeeded)}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {fmtWhen(s.startsAt)}
                    {s.city ? ` · ${s.city}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
                  {s.open} open
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {c.topMatch ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
          <h2 className="font-serif text-lg text-ink-900">
            Suggesties · {c.topMatch.shift.clientName ?? "dienst"} ({formatChefRole(c.topMatch.shift.roleNeeded)})
          </h2>
          <p className="mt-1 text-[11px] text-ink-500">
            Best passende koks voor de meest urgente open dienst — open het rooster om voor te stellen.
          </p>
          {c.topMatch.matches.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">Geen passende koks gevonden (geblokkeerd, bezet of buiten profiel).</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {c.topMatch.matches.map((m) => (
                <li key={m.chef.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900">{m.chef.fullName}</p>
                    {m.reasons[0] ? <p className="text-[11px] text-ink-500">{m.reasons[0]}</p> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-bg-gray px-2.5 py-1 text-[11px] font-medium text-ink-700">
                    match {m.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/business/roster?view=day"
            className="mt-3 inline-flex items-center gap-1 font-ui text-[11px] font-medium text-burgundy hover:underline"
          >
            Naar rooster <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}
    </div>
  );
}
