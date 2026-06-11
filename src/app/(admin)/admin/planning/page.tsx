/**
 * /admin/planning — PLANNER-1. The planner cockpit (owner + planner). A read-only
 * day-radar composed from planner-intel: intake queue, accepted-not-confirmed, open
 * slots in the next 48h / 7d, and match suggestions for the most urgent open shift.
 * Quick-actions deep-link only to planner-accessible pages (inbox / rooster / diensten);
 * Klanten + Uren stay owner-only and are intentionally absent.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Icon } from "@/components/admin/icons";
import { AiQuickAsk } from "@/components/ai/AiQuickAsk";
import { OpsCard } from "@/components/dashboard/OpsCard";
import { aiEnabled } from "@/lib/ai/config";
import { buildDemandForecast } from "@/lib/ai/read-model/demand-forecast";
import { findStaleOpenShifts } from "@/lib/ai/read-model/watchdog";
import { listInboundAdmin } from "@/lib/domain/inbound";
import { matchesViewer, viewerInboxFilter } from "@/lib/domain/inboxes";
import { proposePlacement } from "@/lib/domain/matching";
import { transitionPlacement } from "@/lib/domain/placement-transition";
import { autofillWeek } from "@/lib/domain/roster-autofill";
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
  searchParams: Promise<{ ok?: string; f?: string; o?: string }>;
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
  const [c, report, staleShifts, inboundRows, demand] = await Promise.all([
    getPlannerCockpit(),
    getPlannerReport(),
    findStaleOpenShifts(new Date()),
    listInboundAdmin({ unhandledOnly: true, limit: 50 }),
    buildDemandForecast(new Date(), 2),
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

  // Inline confirm (workbench W1): the SAME atomic transition the shift-detail page and the
  // placements.confirm AI tool use — chef + klant get their confirmation messages downstream.
  async function confirmFromCockpit(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const placementId = String(formData.get("placementId") ?? "").trim();
    if (!placementId) throw new Error("placementId ontbreekt");
    const res = await transitionPlacement({
      placementId,
      newStatus: "confirmed",
      actorUserId: session.user.id,
      expectedStatus: "accepted", // house rule: stale/double clicks become a clean no-op, never a duplicate mail-cascade
    });
    redirect(`/admin/planning?ok=${res.ok && res.changed ? "bevestigd" : "niet-bevestigd"}`);
  }

  // Scale (wave W3): one click and the SAME matching brain pre-fills every open slot of the
  // coming week as CONCEPTS (invisible to chef + klant) — the planner reviews in the planbord
  // and hits Publiceer. Re-runs are harmless: covered slots are skipped.
  async function autofillFromCockpit() {
    "use server";
    const session = await requirePermission("shifts", "write");
    const start = new Date();
    const res = await autofillWeek({
      startUtc: start,
      endUtc: new Date(start.getTime() + 7 * 24 * 3600 * 1000),
      actorUserId: session.user.id,
    });
    redirect(`/admin/planning?ok=voorgevuld&f=${res.filled}&o=${res.openSlotsBefore}`);
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
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Werkbank</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Planning</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Je werkdag in één oogopslag — wat binnenkomt, wat bevestigd moet worden, en waar koks tekortkomen.
      </p>

      {sp.ok ? (
        <p
          className={`mt-4 rounded border px-4 py-2 text-sm ${
            sp.ok === "niet-bevestigd"
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {sp.ok === "al-voorgesteld" ? (
            "Deze kok was al voorgesteld voor die dienst — geen dubbel voorstel verstuurd."
          ) : sp.ok === "bevestigd" ? (
            "✓ Plaatsing bevestigd — chef en klant zijn op de hoogte gebracht."
          ) : sp.ok === "niet-bevestigd" ? (
            "Niet bevestigd — deze plaatsing is intussen gewijzigd of al bevestigd (de lijst is ververst)."
          ) : sp.ok === "voorgevuld" ? (
            <>
              ⚡ {sp.f ?? 0} van {sp.o ?? 0} open plekken als concept voorgevuld — onzichtbaar voor
              chef & klant tot jij publiceert.{" "}
              <Link href="/admin/business/roster/planbord" className="font-medium underline underline-offset-2">
                Review & publiceer in het planbord
              </Link>
            </>
          ) : (
            "✓ Voorstel gestuurd — de kok krijgt bericht en jij ziet de reactie bij 'Te bevestigen'."
          )}
        </p>
      ) : null}
      <AutoRefresh seconds={60} clearParam="ok" />
      {(() => {
        // Quick-ask chips — only when this viewer actually has the assistant (same gate as the
        // layout) and only prompts whose tools sit inside the viewer's scoped registry.
        const isOwner = hasRole(session, "owner", "super_admin");
        const plannerAi = process.env.PLANNER_AI_ENABLED === "true" && hasRole(session, "planner");
        if (!aiEnabled() || (!isOwner && !plannerAi)) return null;
        const urgent = c.open48h[0];
        const items = [
          ...(urgent
            ? [
                {
                  label: "Voorstel voor de urgentste dienst",
                  prompt: `Wie kan ik voorstellen voor de ${formatChefRole(urgent.roleNeeded)}-dienst bij ${urgent.clientName ?? "de klant"} op ${fmtWhen(urgent.startsAt)}?`,
                },
              ]
            : []),
          { label: "Beschikbare chefs deze week", prompt: "Welke chefs zijn deze week nog beschikbaar om in te plannen?" },
          { label: "Wat moet ik nu oppakken?", prompt: "Wat staat er in mijn wachtrij — wat moet ik als planner nu als eerste oppakken?" },
          ...(isOwner
            ? [{ label: "Watchdog", prompt: "Wat ziet je watchdog vandaag — staan er diensten te lang open of zijn er chefs stil?" }]
            : []),
        ];
        return <AiQuickAsk items={items} />;
      })()}

      {staleShifts.length > 0 || flaggedInbound.length > 0 || c.pendingChangeRequests.length > 0 ? (
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
            {c.pendingChangeRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-ink-900">
                  ✋ {r.clientName ?? "Klant"} wil deze dienst {r.kind === "cancel" ? "annuleren" : "wijzigen"} —
                  beslis vóór je verder vult.
                </p>
                <Link
                  href={`/admin/business/shifts/${r.shiftId}`}
                  className="shrink-0 rounded-full border border-red-300 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-red-800 hover:bg-red-100"
                >
                  Bekijk verzoek
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
          lines={[
            { text: "onderbezette diensten deze week", tone: "muted" },
            ...(demand.shortfalls.length > 0
              ? [
                  {
                    text: `vooruit: ${demand.shortfalls
                      .slice(0, 2)
                      .map((s) => `wk ${s.weekNo} ${s.open}× ${s.role}`)
                      .join(" · ")}`,
                    tone: "amber" as const,
                  },
                ]
              : []),
          ]}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg text-ink-900">Kritiek · komende 48 uur</h2>
          <form action={autofillFromCockpit}>
            <button
              type="submit"
              className="rounded-full border border-burgundy/30 bg-burgundy/5 px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-burgundy hover:border-burgundy/60"
              title="De matching-engine vult alle open plekken van de komende 7 dagen als concept — jij reviewt en publiceert in het planbord."
            >
              ⚡ Vul de week automatisch
            </button>
          </form>
        </div>
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

      {c.toConfirm.length > 0 ? (
        <section className="mt-6 rounded-lg border border-amber-200 bg-white p-6">
          <h2 className="font-serif text-lg text-ink-900">Te bevestigen · chef zei ja</h2>
          <p className="mt-1 text-[11px] text-ink-500">
            Eén klik en chef + klant krijgen hun bevestiging — daarna staat de dienst vast.
          </p>
          <ul className="mt-3 divide-y divide-ink-100">
            {c.toConfirm.map((p) => (
              <li key={p.placementId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">
                    {p.chefName} → {p.clientName ?? "—"} · {formatChefRole(p.roleNeeded)}
                  </p>
                  <p className="text-[11px] text-ink-500">{fmtWhen(p.startsAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/admin/business/shifts/${p.shiftId}`}
                    className="rounded-full border border-ink-200 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-ink-600 hover:border-burgundy/40"
                  >
                    Detail
                  </Link>
                  <form action={confirmFromCockpit}>
                    <input type="hidden" name="placementId" value={p.placementId} />
                    <button
                      type="submit"
                      className="rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
                    >
                      Bevestig
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          {c.acceptedUnconfirmed > c.toConfirm.length ? (
            <Link
              href="/admin/business/shifts?tab=open"
              className="mt-3 inline-flex items-center gap-1 font-ui text-[11px] font-medium text-burgundy hover:underline"
            >
              +{c.acceptedUnconfirmed - c.toConfirm.length} meer te bevestigen{" "}
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </section>
      ) : null}

      {c.awaitingChef.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
          <h2 className="font-serif text-lg text-ink-900">Wacht op chef · voorstellen zonder antwoord</h2>
          <p className="mt-1 text-[11px] text-ink-500">
            Oudste eerst — na 24 uur is een belletje vaak sneller dan wachten (het systeem herinnert
            chefs zelf na 24/72 uur).
          </p>
          <ul className="mt-3 divide-y divide-ink-100">
            {c.awaitingChef.map((p) => (
              <li key={p.placementId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">
                    {p.chefName} → {p.clientName ?? "—"} · {formatChefRole(p.roleNeeded)}
                  </p>
                  <p className="text-[11px] text-ink-500">dienst: {fmtWhen(p.startsAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      (p.ageHours ?? 0) >= 72
                        ? "bg-red-50 text-red-700"
                        : (p.ageHours ?? 0) >= 24
                          ? "bg-amber-50 text-amber-700"
                          : "bg-bg-gray text-ink-600"
                    }`}
                  >
                    {p.ageHours ?? 0}u stil
                  </span>
                  <Link
                    href={`/admin/business/shifts/${p.shiftId}`}
                    className="rounded-full border border-ink-200 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-ink-600 hover:border-burgundy/40"
                  >
                    Detail
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {c.topMatches.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
          <h2 className="font-serif text-lg text-ink-900">Suggesties · meest urgente open diensten</h2>
          <p className="mt-1 text-[11px] text-ink-500">
            Best passende koks per urgente dienst — stel direct voor, of open het rooster.
          </p>
          <div className="mt-3 space-y-4">
            {c.topMatches.map(({ shift, matches }) => (
              <div key={shift.id}>
                <p className="font-ui text-[11px] uppercase tracking-[0.14em] text-ink-500">
                  {shift.clientName ?? "dienst"} · {formatChefRole(shift.roleNeeded)} · {fmtWhen(shift.startsAt)} ·{" "}
                  {shift.open} open
                </p>
                {matches.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-500">
                    Geen passende koks gevonden (geblokkeerd, bezet of buiten profiel).
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-2">
                    {matches.map((m) => (
                      <li key={`${shift.id}-${m.chef.id}`} className="flex items-center justify-between gap-3">
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
                            <input type="hidden" name="shiftId" value={shift.id} />
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
              </div>
            ))}
          </div>
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
