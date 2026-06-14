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
          open.map((s) => (
            <div key={s.shiftId} className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                    {formatChefRole(s.role)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink-900">{s.clientName}</p>
                  <p className="mt-0.5 text-xs text-ink-600">
                    {formatWhen(s.startsAt, s.endsAt)}
                    {s.city ? ` · ${s.city}` : ""}
                    {s.rateCents ? ` · ${formatEuro(s.rateCents)}/uur` : ""}
                  </p>
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
          ))
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
