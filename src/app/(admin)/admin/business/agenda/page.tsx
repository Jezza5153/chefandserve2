/**
 * /admin/business/agenda — P2a (owner Agenda, first slice).
 *
 * The operations calendar as a phone-subscribable ICS feed (all shifts + fill status).
 * Lazy-issues users.calendarTokenSecret; rotate to revoke. The day/week/month grid +
 * lenses land in P2c on this same route.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { CopyUrlBlock } from "@/components/CopyUrlBlock";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { deriveCalendarToken, newCalendarSecret } from "@/lib/calendar/ics";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

async function rotateSecret() {
  "use server";
  const session = await requirePermission("cockpit", "read");
  await db
    .update(users)
    .set({ calendarTokenSecret: newCalendarSecret(), updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/admin/business/agenda");
}

export default async function OwnerAgendaPage() {
  const session = await requirePermission("cockpit", "read");

  // Lazy issue the per-user calendar secret on first visit.
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
  const icsUrl = `${origin}/admin/business/calendar.ics?token=${token}`;

  return (
    <div className="max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Agenda</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Operations-agenda — abonneer op je telefoon
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Al je diensten met bezetting in je telefoon-agenda — open plekken verschijnen als{" "}
        <em>voorlopig</em>, volledig bemande als <em>bevestigd</em>, geannuleerde verdwijnen
        vanzelf. De agenda werkt zichzelf bij.
      </p>

      <CopyUrlBlock url={icsUrl} />

      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Hoe abonneer ik?</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-700">
          <li>Kopieer de URL hierboven.</li>
          <li>
            <strong>iPhone:</strong> Instellingen → Agenda → Accounts → Account toevoegen →
            Andere → Agenda-abonnement toevoegen → plak de URL.
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
            <strong>Outlook:</strong> Open agenda → Abonneren op online agenda → plak de URL.
          </li>
        </ol>
        <p className="mt-3 text-xs text-ink-500">
          Een dag/week/maand-overzicht binnen Chef &amp; Serve komt binnenkort op deze pagina.
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
        <h2 className="font-serif text-base text-ink-900">URL gelekt of gestolen?</h2>
        <p className="mt-2 text-sm text-ink-700">
          Vernieuw de link — oude abonnees stoppen met updates en je krijgt een nieuwe URL.
          Je moet daarna opnieuw abonneren op je telefoon.
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
