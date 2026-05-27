/**
 * /client/calendar — PR-CHEF-11. Same shape as /chef/calendar.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { CopyUrlBlock } from "@/components/CopyUrlBlock";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { deriveCalendarToken, newCalendarSecret } from "@/lib/calendar/ics";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

async function rotateSecret() {
  "use server";
  const session = await requireAuth();
  await db
    .update(users)
    .set({ calendarTokenSecret: newCalendarSecret(), updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/client/calendar");
}

export default async function ClientCalendarPage() {
  const session = await requireAuth("/client/calendar");

  let [u] = await db
    .select({ secret: users.calendarTokenSecret })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u?.secret) {
    const secret = newCalendarSecret();
    await db
      .update(users)
      .set({ calendarTokenSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
    u = { secret };
  }

  const token = deriveCalendarToken({ userId: session.user.id, secret: u.secret! });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
  const icsUrl = `${origin}/client/calendar.ics?token=${token}`;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Agenda
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Onze agenda — abonneer in 1 klik
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Al je bevestigde chefs en shifts in je eigen agenda. Wijzigingen
        en annuleringen werken zichzelf bij.
      </p>

      <CopyUrlBlock url={icsUrl} />

      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Hoe abonneer ik?</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-700">
          <li>Kopieer de URL hierboven.</li>
          <li>
            <strong>Google Workspace:</strong> Open Calendar → Andere
            agenda's toevoegen → Via URL → plak.
          </li>
          <li>
            <strong>Outlook 365:</strong> Agenda → Toevoegen → Abonneren
            op online agenda → plak.
          </li>
          <li>
            <strong>iCal / macOS:</strong> Bestand → Nieuw agenda-abonnement
            → plak de URL.
          </li>
        </ol>
      </section>

      <section className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
        <h2 className="font-serif text-base text-ink-900">
          URL gelekt of gestolen?
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          Vernieuw — oude abonnees stoppen met updates. Je moet daarna
          opnieuw abonneren met de nieuwe URL.
        </p>
        <form action={rotateSecret} className="mt-3">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Genereer nieuwe URL
          </button>
        </form>
      </section>
    </div>
  );
}
