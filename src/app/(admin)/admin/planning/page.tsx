/**
 * /admin/planning — PLANNER-1. The planner cockpit (owner + planner). A read-only
 * day-radar composed from planner-intel: intake queue, accepted-not-confirmed, open
 * slots in the next 48h / 7d, and match suggestions for the most urgent open shift.
 * Quick-actions deep-link only to planner-accessible pages (inbox / rooster / diensten);
 * Klanten + Uren stay owner-only and are intentionally absent.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/admin/icons";
import { OpsCard } from "@/components/dashboard/OpsCard";
import { findStaleOpenShifts } from "@/lib/ai/read-model/watchdog";
import { listInboundAdmin } from "@/lib/domain/inbound";
import { matchesViewer, viewerInboxFilter } from "@/lib/domain/inboxes";
import { proposePlacement } from "@/lib/domain/matching";
import { getPlannerCockpit, getPlannerReport } from "@/lib/domain/planner-intel";
import { formatChefRole } from "@/lib/labels";
import { hasRole, requirePermission } from "@/lib/permissions";

export const metadata = { title: "Planning", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Display-cap for the critical list — the full set stays one click away in the roster. */
const CRITICAL_LIST_CAP = 20;

const fmtWhen = (d: Date) =>
  new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(d));

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requirePermission("planning", "read");
  const sp = await searchParams;

  // Aandacht-rail (wave C1): live planning signals — stale shifts (same engine as the watchdog
  // cron) + unhandled spoed/klacht mail, scoped to THIS viewer's inbox-ACL. Planner-signals only:
  // silent chefs + low ratings stay owner-side by design.
  const inboxFilter = await viewerInboxFilter(session.user.id, {
    superAdmin: hasRole(session, "super_admin"),
    owner: hasRole(session, "owner", "super_admin"),
  });
  const [c, report, staleShifts, inboundRows] = await Promise.all([
    getPlannerCockpit(),
    getPlannerReport(),
    findStaleOpenShifts(new Date()),
    listInboundAdmin({ unhandledOnly: true, limit: 50 }),
  ]);
  const flaggedInbound = inboundRows.filter(
    (r) => (r.category === "urgent" || r.category === "complaint") && matchesViewer(r.toEmail, inboxFilter),
  );

  // Inline propose (PR-A1): the SAME domain path as shift detail — one click from the cockpit.
  async function proposeFromCockpit(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const shiftId = String(formData.get("shiftId") ?? "").trim();
    const chefId = String(formData.get("chefId") ?? "").trim();
    const matchScore = formData.get("matchScore") ? Number(formData.get("matchScore")) : undefined;
    if (!shiftId || !chefId) throw new Error("shiftId/chefId ontbreekt");
    const res = await proposePlacement(shiftId, chefId, { proposedBy: session.user.id, matchScore });
    redirect(`/admin/planning?ok=${res.status === "already_proposed" ? "al-voorgesteld" : "voorstel"}`);
  }
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

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sp.ok === "al-voorgesteld"
            ? "Deze kok was al voorgesteld voor die dienst — geen dubbel voorstel verstuurd."
            : "✓ Voorstel gestuurd — de kok krijgt bericht en jij ziet de reactie bij 'Te bevestigen'."}
        </p>
      ) : null}

      {staleShifts.length > 0 || flaggedInbound.length > 0 ? (
        <section className="mt-6 rounded-lg border border-red-200 bg-red-50/50 p-4">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-red-800">Aandacht</h2>
          <ul className="mt-2 space-y-1.5">
            {staleShifts.slice(0, 5).map((s) => (
              <li key={s.shiftId} className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-ink-900">
                  ⏳ {formatChefRole(s.role)} bij {s.client} staat al {s.openForHours}u open ({s.openSlots} plek
                  {s.openSlots === 1 ? "" : "ken"}) — overweeg tarief of bredere selectie.
                </p>
                <Link
                  href={`/admin/business/shifts/${s.shiftId}`}
                  className="shrink-0 rounded-full border border-red-300 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-red-800 hover:bg-red-100"
                >
                  Vul dienst
                </Link>
              </li>
            ))}
            {flaggedInbound.slice(0, 5).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-ink-900">
                  {m.category === "complaint" ? "⚠ Klacht" : "⏱ Spoed"} van{" "}
                  {m.fromName ?? m.fromEmail}
                  {m.subject ? ` — "${m.subject}"` : ""}
                </p>
                <Link
                  href="/admin/business/berichten"
                  className="shrink-0 rounded-full border border-red-300 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-red-800 hover:bg-red-100"
                >
                  Lees & handel af
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          href="/admin/business/shifts?tab=open"
          cta="Bevestigen"
          lines={[
            {
              text:
                c.acceptedUnconfirmed > 0
                  ? "Wat nu? Chef zei ja — bevestig vóór de dienst start"
                  : "niets te bevestigen",
              tone: c.acceptedUnconfirmed > 0 ? "amber" : "muted",
            },
            { text: `${c.proposedPending} voorstel(len) wachten nog op de chef`, tone: "muted" },
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
          <>
            <ul className="mt-3 divide-y divide-ink-100">
              {c.open48h.slice(0, CRITICAL_LIST_CAP).map((s) => (
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
                      {s.open} open
                    </span>
                    <Link
                      href={`/admin/business/shifts/${s.id}`}
                      className="rounded-full border border-burgundy/30 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-burgundy hover:bg-burgundy/5"
                    >
                      Vul dienst
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {c.open48h.length > CRITICAL_LIST_CAP ? (
              <Link
                href="/admin/business/roster?view=day"
                className="mt-3 inline-flex items-center gap-1 font-ui text-[11px] font-medium text-burgundy hover:underline"
              >
                +{c.open48h.length - CRITICAL_LIST_CAP} meer open diensten in het rooster{" "}
                <Icon name="arrow-right" className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </>
        )}
      </section>

      {c.topMatch ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
          <h2 className="font-serif text-lg text-ink-900">
            Suggesties · {c.topMatch.shift.clientName ?? "dienst"} ({formatChefRole(c.topMatch.shift.roleNeeded)})
          </h2>
          <p className="mt-1 text-[11px] text-ink-500">
            Best passende koks voor de meest urgente open dienst — stel direct voor, of open het rooster.
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
                    {m.warnings[0] ? <p className="text-[11px] text-amber-700">⚠ {m.warnings[0]}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-bg-gray px-2.5 py-1 text-[11px] font-medium text-ink-700">
                      match {m.score}
                    </span>
                    <form action={proposeFromCockpit}>
                      <input type="hidden" name="shiftId" value={c.topMatch!.shift.id} />
                      <input type="hidden" name="chefId" value={m.chef.id} />
                      <input type="hidden" name="matchScore" value={m.score} />
                      <button
                        type="submit"
                        className="rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
                      >
                        Voorstel
                      </button>
                    </form>
                  </div>
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
