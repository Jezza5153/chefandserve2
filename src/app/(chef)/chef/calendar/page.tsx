/**
 * /chef/calendar — PR-CHEF-11.
 *
 * Shows the chef's ICS feed URL with copy-to-clipboard + instructions.
 * Lazy-creates calendarTokenSecret on first visit.
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
  revalidatePath("/chef/calendar");
}

export default async function ChefCalendarPage() {
  const session = await requireAuth("/chef/calendar");

  // Lazy issue
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
  const icsUrl = `${origin}/chef/calendar.ics?token=${token}`;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Agenda
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Mijn agenda — abonneer op je telefoon
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Krijg al je bevestigde shifts automatisch in je telefoon-agenda.
        Wijzigen of annuleren? Je agenda werkt zichzelf bij.
      </p>

      <CopyUrlBlock url={icsUrl} />

      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Hoe abonneer ik?</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-700">
          <li>Kopieer de URL hierboven.</li>
          <li>
            <strong>iPhone:</strong> Instellingen → Agenda → Accounts →
            Account toevoegen → Andere → Agenda-abonnement toevoegen → plak
            de URL.
          </li>
          <li>
            <strong>Android (Google):</strong> Open{" "}
            <a
              href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-burgundy hover:underline"
            >
              calendar.google.com → toevoegen via URL
            </a>{" "}
            → plak de URL.
          </li>
          <li>
            <strong>Outlook:</strong> Open agenda → Abonneren op online
            agenda → plak de URL.
          </li>
        </ol>
      </section>

      <section className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
        <h2 className="font-serif text-base text-ink-900">
          URL gelekt of gestolen?
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          Vernieuw de link — oude abonnees stoppen met updates en je krijgt
          een nieuwe URL. Je moet daarna opnieuw abonneren op je telefoon.
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
