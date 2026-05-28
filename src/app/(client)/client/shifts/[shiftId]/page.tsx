/**
 * /client/shifts/[shiftId] — THE klant shift hub (PR-KLANT-0 keystone).
 *
 * The hotel's single source of truth for one shift. Sections in fixed order:
 *   1. Header (klant + date/time + role + location)
 *   2. Status + "Wat gebeurt er nu?"
 *   3. Chefs voor deze shift (proposed/confirmed/cancelled cards)
 *   4. Uren (link + status)
 *   5. Feedback (link when applicable)
 *   6. Acties (Wijziging / Annulering aanvragen — always available)
 *   7. Berichten (client_visible placement_comments)
 *
 * PR-KLANT-0 ships the skeleton + real status/chefs/hours/comments. The
 * interactive bits (comment form, change/cancel modals, rating link) get
 * wired by PR-KLANT-2/3/5 — the section placeholders show "binnenkort"
 * until then so the hub is never a dead end.
 */

import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WhatHappensNext } from "@/components/client/WhatHappensNext";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  placements,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { actionAllowed, getClientShiftLabel } from "@/lib/client-shift-labels";
import { listVisibleComments } from "@/lib/domain/comments";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Shift", robots: { index: false } };
export const dynamic = "force-dynamic";

async function requireClientSelf() {
  const session = await requireAuth();
  if (session.user.kind !== "client" && !session.user.roles.includes("super_admin")) {
    redirect("/");
  }
  const [c] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1);
  if (!c) redirect("/client");
  return { client: c, session };
}

export default async function ClientShiftHubPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const { client } = await requireClientSelf();
  const { shiftId } = await params;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift) notFound();
  if (shift.clientId !== client.id) notFound();

  // All placements on this shift + chef + hours
  const placementRows = await db
    .select({
      p: placements,
      chefName: chefs.fullName,
      chefVakniveau: chefs.vakniveau,
      chefYears: chefs.yearsExperience,
      chefPhone: chefs.phone,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.shiftId, shiftId))
    .orderBy(desc(placements.createdAt));

  // Hours rows for this shift (one per placement at most)
  const hoursRows = await db
    .select({ placementId: shiftHours.placementId, status: shiftHours.status })
    .from(shiftHours)
    .where(eq(shiftHours.shiftId, shiftId));
  const hoursByPlacement = new Map(hoursRows.map((h) => [h.placementId, h.status]));

  // Best (most-progressed) placement for the headline status
  const rank = (s: string) =>
    ["proposed", "accepted", "confirmed", "completed", "cancelled", "rejected", "no_show"].indexOf(s);
  const best = [...placementRows].sort((a, b) => rank(b.p.status) - rank(a.p.status))[0];
  const bestHours = best ? hoursByPlacement.get(best.p.id) ?? null : null;

  const label = getClientShiftLabel({
    shiftStatus: shift.status,
    hasPlacement: Boolean(best),
    placementStatus: best?.p.status ?? null,
    hoursStatus: bestHours,
  });

  // Comments visible to the klant across all placements on this shift
  const commentBlocks = await Promise.all(
    placementRows.map((r) =>
      listVisibleComments(r.p.id, { kind: "client" }),
    ),
  );
  const clientComments = commentBlocks.flat();

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/client/shifts"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Mijn shifts
        </Link>
      </div>

      {/* 1. Header */}
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Shift
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {shift.roleNeeded}
        {shift.segment ? <span className="text-ink-500"> · {shift.segment}</span> : null}
      </h1>
      <p className="mt-2 text-sm text-ink-700">{formatRange(shift.startsAt, shift.endsAt)}</p>
      {shift.location ? (
        <p className="mt-1 text-sm text-ink-500">{shift.location}</p>
      ) : null}

      {/* 2. Status + Wat gebeurt er nu? */}
      <div className="mt-6">
        <WhatHappensNext
          humanStatus={label.humanStatus}
          nextStep={label.nextStep}
          tone={
            label.allowedActions.includes("sign_hours") ||
            label.allowedActions.includes("rate_chef")
              ? "action"
              : label.humanStatus === "Afgerond"
                ? "done"
                : "neutral"
          }
        />
      </div>

      {/* 3. Chefs */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Chef{placementRows.length === 1 ? "" : "s"} voor deze shift
        </h2>
        {placementRows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-white p-5 text-sm text-ink-500">
            Nog geen chef voorgesteld. Chef &amp; Serve zoekt een match.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {placementRows.map(({ p, chefName, chefVakniveau, chefYears }) => (
              <li
                key={p.id}
                className={`rounded-lg border p-5 ${
                  ["cancelled", "rejected", "no_show"].includes(p.status)
                    ? "border-ink-200 bg-bg-gray opacity-70"
                    : "border-ink-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-lg text-ink-900">{chefName}</h3>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {chefVakniveau ?? "—"}
                      {chefYears ? ` · ${chefYears} jaar ervaring` : ""}
                    </p>
                  </div>
                  <PlacementPill status={p.status} />
                </div>
                {/* PR-KLANT-3 fills the "Waarom voorgesteld?" reasons + comment form here */}
                {p.status === "proposed" ? (
                  <p className="mt-3 text-xs text-ink-500">
                    Chef &amp; Serve bekijkt dit voorstel. Opmerking meesturen kan
                    binnenkort hier.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Uren */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Uren
        </h2>
        {bestHours ? (
          <Link
            href={`/client/shifts/${shiftId}/hours`}
            className="mt-3 flex items-center justify-between rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
          >
            <span className="text-sm text-ink-900">Bekijk &amp; controleer uren</span>
            <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy">
              Open →
            </span>
          </Link>
        ) : (
          <p className="mt-3 rounded-lg border border-ink-200 bg-bg-gray p-4 text-sm text-ink-500">
            Nog geen uren ingediend. De chef vult dit in na de shift.
          </p>
        )}
      </section>

      {/* 5. Feedback */}
      {actionAllowed(label, "rate_chef") && best ? (
        <section className="mt-8">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Feedback
          </h2>
          <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-500">
            Feedback geven kan binnenkort hier (PR-KLANT-5).
          </div>
        </section>
      ) : null}

      {/* 6. Acties — always present so the hub never traps the klant */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Acties
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-400">
            Wijziging aanvragen · binnenkort
          </span>
          <span className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-400">
            Annulering aanvragen · binnenkort
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Wil je nu al iets wijzigen of annuleren? Mail of bel het kantoor — de
          knoppen hierboven komen in de volgende update.
        </p>
      </section>

      {/* 7. Berichten */}
      {clientComments.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Berichten
          </h2>
          <ul className="mt-3 space-y-2">
            {clientComments.map((c) => (
              <li
                key={c.id}
                className="rounded border border-ink-200 bg-white px-4 py-2 text-sm"
              >
                <p className="text-ink-900">{c.body}</p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {c.authorKind === "admin" ? "Chef & Serve" : "Jij"} ·{" "}
                  {new Date(c.createdAt).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function formatRange(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function PlacementPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    proposed: "Voorgesteld",
    accepted: "Toegezegd",
    confirmed: "Bevestigd",
    cancelled: "Geannuleerd",
    rejected: "Niet beschikbaar",
    no_show: "No-show",
    completed: "Afgerond",
  };
  const tone =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "accepted"
        ? "bg-blue-100 text-blue-700"
        : status === "proposed"
          ? "bg-amber-100 text-amber-800"
          : status === "completed"
            ? "bg-bg-gray text-ink-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
