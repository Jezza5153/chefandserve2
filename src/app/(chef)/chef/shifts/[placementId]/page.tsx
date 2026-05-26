import { eq } from "drizzle-orm";
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
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Shift" };

export default async function ChefShiftDetailPage({
  params,
}: {
  params: Promise<{ placementId: string }>;
}) {
  const session = await requireAuth();
  const { placementId } = await params;

  const placement = await db.query.placements.findFirst({
    where: eq(placements.id, placementId),
  });
  if (!placement) notFound();

  // Verify this placement belongs to the logged-in chef (security)
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.id, placement.chefId),
  });
  if (!chef || chef.userId !== session.user.id) {
    // super_admin may bypass for impersonation
    if (!session.user.roles.includes("super_admin")) notFound();
  }

  const shift = await db.query.shifts.findFirst({
    where: eq(shifts.id, placement.shiftId),
  });
  if (!shift) notFound();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, shift.clientId),
  });

  async function respond(formData: FormData) {
    "use server";
    const session = await requireAuth();
    const decision = String(formData.get("decision") ?? "") as
      | "accepted"
      | "rejected";
    if (decision !== "accepted" && decision !== "rejected") return;

    await db
      .update(placements)
      .set({
        status: decision,
        respondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(placements.id, placementId));

    await db.insert(auditLog).values({
      userId: session.user.id,
      action: `placements.chef_${decision}`,
      resource: "placements",
      resourceId: placementId,
    });

    redirect("/chef");
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/chef"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Shift-voorstel
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {shift.roleNeeded}
        {shift.segment && (
          <span className="ml-2 text-ink-500">· {shift.segment}</span>
        )}
      </h1>
      <p className="mt-2 text-sm text-ink-700">{client?.companyName ?? "—"}</p>

      <div className="mt-8 grid gap-3 rounded-lg border border-ink-200 bg-white p-6">
        <Row label="Wanneer" value={formatRange(shift.startsAt, shift.endsAt)} />
        <Row label="Locatie" value={shift.location ?? shift.city ?? "—"} />
        <Row
          label="Tarief"
          value={
            shift.chefRateCents
              ? `€${(shift.chefRateCents / 100).toFixed(2)} per uur`
              : "Nog niet vastgesteld"
          }
        />
        {shift.notes && <Row label="Notities" value={shift.notes} />}
      </div>

      {/* Decision */}
      {placement.status === "proposed" ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink-900">Wil je deze shift?</h2>
          <p className="mt-1 text-sm text-ink-700">
            Reageer zo snel mogelijk. Maarten ziet je antwoord direct.
          </p>
          <div className="mt-4 flex gap-3">
            <form action={respond}>
              <input type="hidden" name="decision" value="accepted" />
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
              >
                ✓ Ja, ik kom
              </button>
            </form>
            <form action={respond}>
              <input type="hidden" name="decision" value="rejected" />
              <button
                type="submit"
                className="rounded-full border border-red-300 bg-white px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-red-700 hover:bg-red-50"
              >
                ✗ Niet beschikbaar
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-700">
          Status:{" "}
          <strong className="text-ink-900">
            {labelFor(placement.status)}
          </strong>
          {placement.respondedAt &&
            ` · gereageerd ${new Date(placement.respondedAt).toLocaleDateString("nl-NL")}`}
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink-900">{value}</p>
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function labelFor(status: string): string {
  return (
    {
      proposed: "Voorgesteld",
      accepted: "Geaccepteerd",
      confirmed: "Bevestigd",
      rejected: "Afgewezen",
      cancelled: "Geannuleerd",
      completed: "Afgerond",
      no_show: "No-show",
    } as Record<string, string>
  )[status] ?? status;
}
