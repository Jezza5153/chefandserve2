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
import { getI18n } from "@/lib/i18n/server";
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
  const { dict: t } = await getI18n();

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
        {t.calendar.eyebrow}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {t.calendar.title}
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">{t.calendar.intro}</p>

      <CopyUrlBlock url={icsUrl} />

      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">{t.calendar.howTo}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-700">
          <li>{t.calendar.stepCopy}</li>
          <li>
            <strong>{t.calendar.iphoneLabel}</strong>
            {t.calendar.iphoneBody}
          </li>
          <li>
            <strong>{t.calendar.androidLabel}</strong>
            {t.calendar.androidPre}
            <a
              href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-burgundy hover:underline"
            >
              {t.calendar.androidLink}
            </a>
            {t.calendar.androidPost}
          </li>
          <li>
            <strong>{t.calendar.outlookLabel}</strong>
            {t.calendar.outlookBody}
          </li>
        </ol>
      </section>

      <section className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
        <h2 className="font-serif text-base text-ink-900">{t.calendar.leakedTitle}</h2>
        <p className="mt-2 text-sm text-ink-700">{t.calendar.leakedBody}</p>
        <form action={rotateSecret} className="mt-3">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            {t.calendar.regenerate}
          </button>
        </form>
      </section>
    </div>
  );
}
