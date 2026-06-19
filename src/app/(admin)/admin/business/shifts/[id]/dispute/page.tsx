/**
 * /admin/business/shifts/[id]/dispute — CHEF-PR4 (R2#29) dispute evidence view.
 *
 * "De klant zegt dat de chef er niet was." This is the practical payoff of the
 * in-shift signals + Arrival Trust timeline: for each chef on the shift it shows
 * what we actually know — arrival signal y/n, the one-tap signal timeline, whether
 * hours were submitted (the clock-out proxy) — plus one-tap bel-chef / bel-klant.
 * Read-only evidence; owner/ops only (cockpit.read). No accusations: "geen
 * aankomstsignaal ontvangen" never "chef was er niet".
 */
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftArrivalChecks, shiftHours, shiftSignals, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Dispuut — was de chef aanwezig?" };
export const dynamic = "force-dynamic";

const SIGNAL_LABEL: Record<string, string> = {
  onderweg: "Onderweg",
  vertraagd: "Vertraagd",
  hulp: "Hulp nodig",
  onveilig: "Voelde zich niet veilig",
  kan_niet_starten: "Kon niet starten",
  langer_doorwerken: "Werkte langer door",
  geen_pauze: "Geen pauze",
  al_op_locatie: "Was op locatie",
};
const ARRIVAL_LABEL: Record<string, string> = {
  monitoring: "Aankomstcontrole gestart",
  nearby: "Binnen 1 km bevestigd",
  no_signal: "Geen aankomstsignaal ontvangen",
  permission_missing: "Locatie niet toegestaan",
  stopped: "Aankomstcontrole gestopt",
};

const dt = (d: Date) =>
  new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export default async function ShiftDisputePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("cockpit", "read");
  const { id: shiftId } = await params;

  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  if (!shift) {
    return <p className="mx-auto max-w-3xl p-8 text-sm text-ink-500">Shift niet gevonden.</p>;
  }
  const client = await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) });

  // The chefs who were actually on this shift (not rejected proposals).
  const pls = await db
    .select({
      placementId: placements.id,
      chefId: placements.chefId,
      status: placements.status,
      chefName: chefs.fullName,
      chefPhone: chefs.phone,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(placements.shiftId, shiftId),
        inArray(placements.status, ["accepted", "confirmed", "completed", "no_show"]),
      ),
    );

  const placementIds = pls.map((p) => p.placementId);
  const chefIds = pls.map((p) => p.chefId);

  const signals = placementIds.length
    ? await db
        .select({ placementId: shiftSignals.placementId, kind: shiftSignals.kind, detail: shiftSignals.detail, createdAt: shiftSignals.createdAt })
        .from(shiftSignals)
        .where(inArray(shiftSignals.placementId, placementIds))
        .orderBy(shiftSignals.createdAt)
    : [];
  const arrivals = chefIds.length
    ? await db
        .select({ chefId: shiftArrivalChecks.chefId, status: shiftArrivalChecks.status, nearbyConfirmedAt: shiftArrivalChecks.nearbyConfirmedAt })
        .from(shiftArrivalChecks)
        .where(and(eq(shiftArrivalChecks.shiftId, shiftId), inArray(shiftArrivalChecks.chefId, chefIds)))
    : [];
  const hours = placementIds.length
    ? await db
        .select({ placementId: shiftHours.placementId, status: shiftHours.status, submittedAt: shiftHours.submittedAt })
        .from(shiftHours)
        .where(inArray(shiftHours.placementId, placementIds))
    : [];

  const tel = (p: string | null) => (p ? p.replace(/[^+\d]/g, "") : "");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href={`/admin/business/shifts/${shiftId}`} className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
          ← Shift
        </Link>
      </div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Dispuut</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Was de chef aanwezig?</h1>
      <p className="mt-2 text-sm text-ink-700">
        {formatShiftRole(shift.roleNeeded)} bij {client?.companyName ?? "—"} · {dt(shift.startsAt)}.
        Hieronder wat we echt weten — geen oordeel. Bel beide partijen om het op te lossen.
      </p>

      {pls.length === 0 ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-6 text-sm text-ink-500">
          Geen chef geplaatst op deze shift.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {pls.map((p) => {
            const sig = signals.filter((s) => s.placementId === p.placementId);
            const arr = arrivals.find((a) => a.chefId === p.chefId);
            const hrs = hours.find((h) => h.placementId === p.placementId);
            const arrivedSignal =
              arr?.status === "nearby" || sig.some((s) => s.kind === "al_op_locatie" || s.kind === "onderweg");
            const hoursSubmitted = !!hrs?.submittedAt;
            return (
              <section key={p.placementId} className="rounded-lg border border-ink-200 bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-serif text-lg text-ink-900">{p.chefName}</p>
                  <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">{p.status}</span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Fact label="Aankomstsignaal" ok={arrivedSignal}
                    value={arr ? ARRIVAL_LABEL[arr.status] ?? arr.status : arrivedSignal ? "Chef gaf zelf door" : "Geen signaal ontvangen"} />
                  <Fact label="Uren ingediend (clock-out)" ok={hoursSubmitted}
                    value={hoursSubmitted ? `Ja · ${hrs?.submittedAt ? dt(hrs.submittedAt) : ""}` : `Nee${hrs ? ` (status: ${hrs.status})` : ""}`} />
                </div>

                {sig.length > 0 ? (
                  <div className="mt-3">
                    <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Signalen van de chef</p>
                    <ul className="mt-1.5 space-y-1 text-sm text-ink-800">
                      {sig.map((s, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-ink-400">{dt(s.createdAt)}</span>
                          <span>{SIGNAL_LABEL[s.kind] ?? s.kind}{s.detail ? ` · ${s.detail}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-500">Geen in-shift signalen ontvangen van deze chef.</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {p.chefPhone ? (
                    <a href={`tel:${tel(p.chefPhone)}`} className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900">
                      Bel chef
                    </a>
                  ) : null}
                  {client?.phone ? (
                    <a href={`tel:${tel(client.phone)}`} className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5">
                      Bel klant{client.contactName ? ` (${client.contactName})` : ""}
                    </a>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm text-ink-900">
        <span className="mr-1">{ok ? "✓" : "—"}</span>
        {value}
      </p>
    </div>
  );
}
