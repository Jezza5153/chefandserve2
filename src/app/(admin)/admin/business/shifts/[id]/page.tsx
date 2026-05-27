import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import {
  auditLog,
  chefs,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
import {
  findMatchesForShift,
  proposePlacement,
} from "@/lib/domain/matching";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Shift" };

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("owner");
  const { id } = await params;

  const shift = await db.query.shifts.findFirst({
    where: eq(shifts.id, id),
    with: undefined,
  });
  if (!shift) notFound();

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, shift.clientId),
  });

  const existingPlacements = await db
    .select({
      placement: placements,
      chef: chefs,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.shiftId, id))
    .orderBy(desc(placements.proposedAt));

  // Suggested chefs (skip if all placements confirmed for headcount)
  const confirmedCount = existingPlacements.filter(
    (p) => p.placement.status === "accepted" || p.placement.status === "confirmed",
  ).length;
  const matches =
    confirmedCount < shift.headcount
      ? await findMatchesForShift(id, { limit: 10 })
      : [];

  async function propose(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const chefId = String(formData.get("chefId") ?? "").trim();
    const matchScore = formData.get("matchScore")
      ? Number(formData.get("matchScore"))
      : undefined;
    if (!chefId) throw new Error("chefId missing");

    const { placementId } = await proposePlacement(id, chefId, {
      proposedBy: session.user.id,
      matchScore,
    });

    await db.insert(auditLog).values({
      userId: session.user.id,
      action: "placements.propose",
      resource: "placements",
      resourceId: placementId,
      after: { shiftId: id, chefId, matchScore },
    });

    redirect(`/admin/business/shifts/${id}`);
  }

  async function setPlacementStatus(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const placementId = String(formData.get("placementId") ?? "").trim();
    const newStatus = String(formData.get("newStatus") ?? "") as
      | "accepted"
      | "confirmed"
      | "rejected"
      | "cancelled";

    const setMap: Record<string, Date> = {
      accepted: new Date(),
      confirmed: new Date(),
      rejected: new Date(),
      cancelled: new Date(),
    };

    await db
      .update(placements)
      .set({
        status: newStatus,
        respondedAt: ["accepted", "rejected"].includes(newStatus)
          ? setMap[newStatus]
          : undefined,
        confirmedAt: newStatus === "confirmed" ? setMap[newStatus] : undefined,
        cancelledAt: newStatus === "cancelled" ? setMap[newStatus] : undefined,
        updatedAt: new Date(),
      })
      .where(eq(placements.id, placementId));

    await db.insert(auditLog).values({
      userId: session.user.id,
      action: `placements.${newStatus}`,
      resource: "placements",
      resourceId: placementId,
    });

    // Send client-confirmation email when a placement reaches "confirmed"
    if (newStatus === "confirmed") {
      try {
        const placement = await db.query.placements.findFirst({
          where: eq(placements.id, placementId),
        });
        if (placement) {
          const chef = await db.query.chefs.findFirst({
            where: eq(chefs.id, placement.chefId),
          });
          const shift = await db.query.shifts.findFirst({
            where: eq(shifts.id, placement.shiftId),
          });
          const clientRow = shift
            ? await db.query.clients.findFirst({
                where: eq(clients.id, shift.clientId),
              })
            : null;
          if (chef && shift) {
            const { sendEmail, formatShiftWhen } = await import("@/lib/email");
            const { recordEmailMessage, createNotification } = await import(
              "@/lib/integrations"
            );
            const { ShiftConfirmedClientEmail } = await import(
              "@/emails/ShiftConfirmedClientEmail"
            );
            const { ShiftConfirmedChefEmail } = await import(
              "@/emails/ShiftConfirmedChefEmail"
            );
            const shiftWhen = formatShiftWhen(shift.startsAt, shift.endsAt);

            // KLANT email (existing behavior)
            if (clientRow?.email) {
              const send = await sendEmail({
                to: clientRow.email,
                subject: `Chef bevestigd voor ${clientRow.companyName} — ${shift.roleNeeded}`,
                react: ShiftConfirmedClientEmail({
                  clientContactName: clientRow.contactName,
                  companyName: clientRow.companyName,
                  chefName: chef.fullName,
                  chefVakniveau: chef.vakniveau,
                  chefYears: chef.yearsExperience,
                  shiftWhen,
                  shiftLocation: shift.location ?? shift.city,
                  shiftRole: shift.roleNeeded,
                }),
              });
              if (send.ok) {
                await recordEmailMessage({
                  providerMessageId: send.id,
                  toEmail: clientRow.email,
                  template: "ShiftConfirmedClientEmail",
                  eventKey: "shift_confirmed",
                  entityType: "placement",
                  entityId: placementId,
                  userId: clientRow.userId ?? undefined,
                });
              }
            }

            // CHEF email (PR-CHEF-5 new — chef closes the loop too)
            if (chef.email) {
              const send = await sendEmail({
                to: chef.email,
                subject: `Shift bevestigd: ${shift.roleNeeded} bij ${clientRow?.companyName ?? "klant"}`,
                react: ShiftConfirmedChefEmail({
                  chefName: chef.fullName,
                  clientName: clientRow?.companyName ?? "—",
                  shiftWhen,
                  shiftLocation: shift.location ?? shift.city,
                  shiftRole: shift.roleNeeded,
                  clientContactName: clientRow?.contactName,
                  clientContactPhone: clientRow?.phone,
                }),
              });
              if (send.ok) {
                await recordEmailMessage({
                  providerMessageId: send.id,
                  toEmail: chef.email,
                  template: "ShiftConfirmedChefEmail",
                  eventKey: "shift_confirmed",
                  entityType: "placement",
                  entityId: placementId,
                  userId: chef.userId ?? undefined,
                });
              }
            }

            // In-app notification for the chef
            if (chef.userId) {
              await createNotification({
                userId: chef.userId,
                type: "shift_confirmed",
                title: `Shift bevestigd bij ${clientRow?.companyName ?? "klant"}`,
                body: shiftWhen,
                actionUrl: `/chef/shifts/${placementId}`,
                entityType: "placement",
                entityId: placementId,
              });
            }
          }
        }
      } catch (e) {
        console.error("[confirmed] notification failed:", e);
      }
    }

    redirect(`/admin/business/shifts/${id}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link
          href="/admin/business/shifts"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Shifts
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Shift
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {shift.roleNeeded}
            {shift.segment && (
              <span className="ml-2 text-ink-500">· {shift.segment}</span>
            )}
          </h1>
          <p className="mt-2 text-sm text-ink-700">
            <Link
              href={`/admin/business/clients/${shift.clientId}`}
              className="text-burgundy underline-offset-4 hover:underline"
            >
              {client?.companyName ?? "(klant verwijderd)"}
            </Link>
            {" · "}
            {formatDateRange(shift.startsAt, shift.endsAt)}
            {shift.city && ` · ${shift.city}`}
          </p>
        </div>
        <StatusBadge status={shift.status} />
      </div>

      {/* Summary card */}
      <div className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-3">
        <SummaryCell label="Aantal nodig" value={shift.headcount.toString()} />
        <SummaryCell
          label="Bevestigd"
          value={`${confirmedCount} / ${shift.headcount}`}
          highlight={confirmedCount >= shift.headcount}
        />
        <SummaryCell
          label="Tarief klant"
          value={shift.clientRateCents ? `€${(shift.clientRateCents / 100).toFixed(2)}/u` : "—"}
        />
        <SummaryCell
          label="Tarief chef"
          value={shift.chefRateCents ? `€${(shift.chefRateCents / 100).toFixed(2)}/u` : "—"}
        />
        <SummaryCell label="Locatie" value={shift.location ?? "—"} />
        <SummaryCell label="Notities" value={shift.notes ?? "—"} />
      </div>

      {/* Existing placements */}
      {existingPlacements.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            Voorgestelde chefs ({existingPlacements.length})
          </h2>
          <ul className="mt-4 space-y-2">
            {existingPlacements.map(({ placement, chef }) => (
              <li
                key={placement.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-ink-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/business/chefs/${chef.id}`}
                    className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                  >
                    {chef.fullName}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {chef.vakniveau ?? "—"} · {chef.city ?? "—"}
                    {placement.matchScore && ` · match-score: ${placement.matchScore}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PlacementStatusBadge status={placement.status} />
                  {placement.status === "proposed" && (
                    <>
                      <PlacementAction
                        action={setPlacementStatus}
                        placementId={placement.id}
                        newStatus="accepted"
                        label="✓ Accepteer"
                        tone="green"
                      />
                      <PlacementAction
                        action={setPlacementStatus}
                        placementId={placement.id}
                        newStatus="rejected"
                        label="✗ Wijs af"
                        tone="red"
                      />
                    </>
                  )}
                  {placement.status === "accepted" && (
                    <PlacementAction
                      action={setPlacementStatus}
                      placementId={placement.id}
                      newStatus="confirmed"
                      label="Bevestig"
                      tone="green"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Match suggestions */}
      {matches.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            Match-suggesties (top {matches.length})
          </h2>
          <p className="mt-2 text-sm text-ink-700">
            Gerankt op vakniveau × segment × ervaring. Bestaande voorstellen
            zijn uitgesloten.
          </p>
          <ul className="mt-4 space-y-2">
            {matches.map((m) => (
              <li
                key={m.chef.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-ink-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/business/chefs/${m.chef.id}`}
                      className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {m.chef.fullName}
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${scoreTone(m.score)}`}
                    >
                      {m.score}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {m.chef.vakniveau ?? "—"} · {m.chef.city ?? "—"}
                    {m.chef.yearsExperience && ` · ${m.chef.yearsExperience}j ervaring`}
                  </p>
                  {m.reasons.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1">
                      {m.reasons.map((r) => (
                        <li
                          key={r}
                          className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700"
                        >
                          ✓ {r}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.warnings.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {m.warnings.map((w) => (
                        <li
                          key={w}
                          className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700"
                        >
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <form action={propose}>
                  <input type="hidden" name="chefId" value={m.chef.id} />
                  <input type="hidden" name="matchScore" value={m.score} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
                  >
                    Voorstel
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {matches.length === 0 && existingPlacements.length === 0 && (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">
            Geen geschikte chefs gevonden
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Voeg meer chefs toe of pas de shift-criteria aan.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-serif text-base ${
          highlight ? "text-emerald-700" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PlacementAction({
  action,
  placementId,
  newStatus,
  label,
  tone,
}: {
  action: (formData: FormData) => Promise<void>;
  placementId: string;
  newStatus: string;
  label: string;
  tone: "green" | "red";
}) {
  const c =
    tone === "green"
      ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      : "border-red-300 text-red-700 hover:bg-red-50";
  return (
    <form action={action}>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="newStatus" value={newStatus} />
      <button
        type="submit"
        className={`rounded-full border px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${c}`}
      >
        {label}
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "open"
      ? "bg-amber-100 text-amber-700"
      : status === "filled"
        ? "bg-emerald-100 text-emerald-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : status === "cancelled"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function PlacementStatusBadge({ status }: { status: string }) {
  const tone =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "accepted"
        ? "bg-blue-100 text-blue-700"
        : status === "proposed"
          ? "bg-amber-100 text-amber-700"
          : status === "rejected" || status === "cancelled" || status === "no_show"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 60) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-bg-gray text-ink-500";
}

function formatDateRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
