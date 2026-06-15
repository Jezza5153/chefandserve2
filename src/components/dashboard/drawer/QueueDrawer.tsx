import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftHours, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { confirmFromDashboard, approveHoursFromDashboard } from "@/app/(admin)/admin/business/_actions";

/** The aggregate-count signals open a queue: list the items + a per-row in-place action. */
export type QueueKind = "accepted_unconfirmed" | "hours_to_approve" | "proposed_no_response";

const LIMIT = 25;

export async function QueueDrawer({ kind }: { kind: QueueKind }) {
  if (kind === "accepted_unconfirmed") return <AcceptedUnconfirmed />;
  if (kind === "hours_to_approve") return <HoursToApprove />;
  if (kind === "proposed_no_response") return <ProposedNoResponse />;
  return <p className="text-sm text-ink-700">Onbekende wachtrij.</p>;
}

/* ---- accepted, awaiting admin confirmation → Bevestig ---- */
async function AcceptedUnconfirmed() {
  const rows = await db
    .select({
      placementId: placements.id,
      chefName: chefs.fullName,
      companyName: clients.companyName,
      roleNeeded: shifts.roleNeeded,
      startsAt: shifts.startsAt,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .leftJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.status, "accepted"))
    .orderBy(asc(shifts.startsAt))
    .limit(LIMIT);

  if (rows.length === 0) return <Empty>Niets meer te bevestigen — alles is rond.</Empty>;

  return (
    <Wrap intro="Chef zei ja — bevestig met de klant zodat de dienst rond is.">
      {rows.map((r) => (
        <Row key={r.placementId} title={r.chefName ?? "Chef"} sub={`${r.companyName ?? "Klant"} · ${formatShiftRole(r.roleNeeded)} · ${dateLabel(r.startsAt)}`}>
          <form action={confirmFromDashboard}>
            <input type="hidden" name="placementId" value={r.placementId} />
            <Action>Bevestig</Action>
          </form>
        </Row>
      ))}
    </Wrap>
  );
}

/* ---- client-signed hours → Keur uren ---- */
async function HoursToApprove() {
  const rows = await db
    .select({
      hoursId: shiftHours.id,
      workedMinutes: shiftHours.workedMinutes,
      startedAt: shiftHours.startedAt,
      chefName: chefs.fullName,
      companyName: clients.companyName,
    })
    .from(shiftHours)
    .leftJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .leftJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(eq(shiftHours.status, "client_signed"))
    .orderBy(asc(shiftHours.startedAt))
    .limit(LIMIT);

  if (rows.length === 0) return <Empty>Geen urenbriefjes te keuren.</Empty>;

  return (
    <Wrap intro="Klant heeft getekend — keur de uren zodat ze de loonadministratie in kunnen.">
      {rows.map((r) => (
        <Row
          key={r.hoursId}
          title={r.chefName ?? "Chef"}
          sub={`${r.companyName ?? "Klant"} · ${hoursLabel(r.workedMinutes)} · ${dateLabel(r.startedAt)}`}
        >
          <form action={approveHoursFromDashboard}>
            <input type="hidden" name="hoursId" value={r.hoursId} />
            <Action>Keur uren</Action>
          </form>
        </Row>
      ))}
    </Wrap>
  );
}

/* ---- proposed, no chef response → Bekijk (contact/log lands in DASH-5) ---- */
async function ProposedNoResponse() {
  const rows = await db
    .select({
      shiftId: placements.shiftId,
      chefName: chefs.fullName,
      companyName: clients.companyName,
      roleNeeded: shifts.roleNeeded,
      startsAt: shifts.startsAt,
      proposedAt: placements.proposedAt,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .leftJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.status, "proposed"))
    .orderBy(desc(placements.proposedAt))
    .limit(LIMIT);

  if (rows.length === 0) return <Empty>Geen openstaande voorstellen.</Empty>;

  return (
    <Wrap intro="Voorgesteld, nog geen reactie. Open de dienst om op te volgen (bellen/loggen komt in een volgende stap).">
      {rows.map((r, i) => (
        <Row key={i} title={r.chefName ?? "Chef"} sub={`${r.companyName ?? "Klant"} · ${formatShiftRole(r.roleNeeded)} · ${dateLabel(r.startsAt)}`}>
          {/* No-fake-action rule: this is a link, so it reads "Bekijk", not "Los op". */}
          <Link
            href={`/admin/business/shifts/${r.shiftId}`}
            className="shrink-0 rounded-full border border-burgundy/40 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-burgundy hover:bg-burgundy/5"
          >
            Bekijk
          </Link>
        </Row>
      ))}
    </Wrap>
  );
}

/* ---- presentational ---- */
function Wrap({ intro, children }: { intro: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">{intro}</p>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}
function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-sm text-ink-900">{title}</p>
        <p className="truncate text-xs text-ink-500">{sub}</p>
      </div>
      {children}
    </li>
  );
}
function Action({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="shrink-0 rounded-full bg-burgundy px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
    >
      {children}
    </button>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-bg-gray px-3 py-4 text-sm text-ink-700">{children}</p>;
}

function dateLabel(d: Date | string): string {
  const dt = new Date(d);
  return dt.toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}u` : `${h}u${String(m).padStart(2, "0")}`;
}
