/**
 * /chef/open — "Open diensten": browse open shifts and raise your hand
 * (CHEF-OPEN, express-interest). Gated by chefOpenShiftsEnabled(). The planner
 * still curates the placement — interest is a signal, not a self-assignment.
 */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import {
  chefOpenShiftsEnabled,
  expressInterest,
  listOpenShiftsForChef,
  withdrawInterest,
} from "@/lib/domain/shift-interests";
import { formatEuro } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Open diensten" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

function formatWhen(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  }).format(start);
  const t = (x: Date) =>
    new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(x);
  return `${day} · ${t(start)}–${t(end)}`;
}

/** Fit% badge tone — green strong, amber decent, grey weak. */
function fitTone(score: number): string {
  if (score >= 80) return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-bg-gray text-ink-600 ring-ink-200";
}

/** Urgency label — only shown when the shift starts soon (<24h). */
function urgencyLabel(hoursUntilStart: number): string | null {
  if (hoursUntilStart >= 24) return null;
  if (hoursUntilStart < 2) return "Spoed · begint binnen 2 uur";
  return `Spoed · begint over ${Math.round(hoursUntilStart)} uur`;
}

/** "~12 km" road estimate. */
function formatKm(km: number): string {
  return km < 10 ? `~${km.toFixed(0)} km` : `~${Math.round(km)} km`;
}

async function interestAction(fd: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  const shiftId = String(fd.get("shiftId") ?? "");
  if (!chef || !shiftId) return;
  await expressInterest({ chefId: chef.id, shiftId });
  revalidatePath("/chef/open");
}

async function withdrawAction(fd: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  const shiftId = String(fd.get("shiftId") ?? "");
  if (!chef || !shiftId) return;
  await withdrawInterest({ chefId: chef.id, shiftId });
  revalidatePath("/chef/open");
}

export default async function ChefOpenShiftsPage() {
  const session = await requireAuth("/chef/open");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });

  if (!chefOpenShiftsEnabled() || !chef) {
    return (
      <div>
        <p className={LABEL}>Rooster</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Open diensten</h1>
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Open diensten zijn er binnenkort.
        </p>
      </div>
    );
  }

  const open = await listOpenShiftsForChef(chef.id);

  return (
    <div>
      <p className={LABEL}>Rooster</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Open diensten</h1>
      <p className="mt-2 text-sm text-ink-600">
        Diensten waar nog plek is. Geef aan dat je interesse hebt — wij koppelen terug en
        bevestigen het definitief.
      </p>

      <div className="mt-6 space-y-3">
        {open.length === 0 ? (
          <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
            Geen open diensten op dit moment. Kijk later nog eens.
          </p>
        ) : (
          open.map((s) => {
            const urgency = urgencyLabel(s.hoursUntilStart);
            return (
              <div key={s.shiftId} className="rounded-lg border border-ink-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                        {formatChefRole(s.role)}
                      </p>
                      {s.fitScore != null && (
                        <span
                          className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-semibold ring-1 ${fitTone(s.fitScore)}`}
                        >
                          {s.fitScore}% match
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink-900">{s.clientName}</p>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {formatWhen(s.startsAt, s.endsAt)}
                      {s.city ? ` · ${s.city}` : ""}
                      {s.rateCents ? ` · ${formatEuro(s.rateCents)}/uur` : ""}
                    </p>

                    {/* CHEF-PR1 — trust signals */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {urgency && (
                        <span className="rounded-full bg-burgundy/10 px-2 py-0.5 font-medium text-burgundy">
                          ⏱ {urgency}
                        </span>
                      )}
                      {s.distanceKm != null && (
                        <span className="rounded-full bg-bg-gray px-2 py-0.5 text-ink-700">
                          📍 {formatKm(s.distanceKm)}
                        </span>
                      )}
                      {s.grossCents != null && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                          ≈ {formatEuro(s.grossCents)} bruto
                        </span>
                      )}
                    </div>

                    {s.reasons.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-ui text-[11px] font-medium text-burgundy">
                          Waarom krijg ik deze shift?
                        </summary>
                        <ul className="mt-1.5 flex flex-wrap gap-1">
                          {s.reasons.map((r) => (
                            <li
                              key={r}
                              className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800"
                            >
                              {r}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {s.grossCents != null && (
                      <p className="mt-1.5 text-[10px] text-ink-400">
                        Indicatie. Netto hangt af van loonheffing en je situatie.
                      </p>
                    )}
                  </div>

                  {s.interested ? (
                    <form action={withdrawAction} className="shrink-0">
                      <input type="hidden" name="shiftId" value={s.shiftId} />
                      <button className="rounded-full border border-burgundy bg-burgundy/10 px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy">
                        ✓ Interesse · intrekken
                      </button>
                    </form>
                  ) : (
                    <form action={interestAction} className="shrink-0">
                      <input type="hidden" name="shiftId" value={s.shiftId} />
                      <button className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90">
                        Ik heb interesse
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-6 text-xs text-ink-500">
        Terug naar je{" "}
        <Link href="/chef/shifts" className="text-burgundy hover:underline">
          shifts
        </Link>
        .
      </p>
    </div>
  );
}
