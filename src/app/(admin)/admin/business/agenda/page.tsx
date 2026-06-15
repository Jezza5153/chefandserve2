/**
 * /admin/business/agenda — owner Agenda (P2a subscribe + P2c grid).
 *
 * Day/week/month operations agenda from DERIVED data (shifts + pending change-requests
 * via getAgendaEvents) — open shifts deep-link into the dashboard "Vul deze dienst"
 * drawer. Below it: the phone-subscribable ICS feed. (Manual one-off events + client/chef
 * lenses arrive with the agenda_events table later.)
 */

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { CopyUrlBlock } from "@/components/CopyUrlBlock";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { deriveCalendarToken, newCalendarSecret } from "@/lib/calendar/ics";
import { getAgendaEvents, type AgendaEvent, type AgendaTone } from "@/lib/domain/agenda";
import { amsterdamDayKey, amsterdamMidnightUtc, addDaysToKey } from "@/lib/roster-format";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

type View = "dag" | "week" | "maand";
const VIEW_DAYS: Record<View, number> = { dag: 1, week: 7, maand: 30 };

async function rotateSecret() {
  "use server";
  const session = await requirePermission("cockpit", "read");
  await db
    .update(users)
    .set({ calendarTokenSecret: newCalendarSecret(), updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/admin/business/agenda");
}

export default async function OwnerAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requirePermission("cockpit", "read");
  const sp = await searchParams;
  const view: View = sp.view === "dag" || sp.view === "maand" ? sp.view : "week";

  // Window in Amsterdam time.
  const now = new Date();
  const todayKey = amsterdamDayKey(now);
  const from = amsterdamMidnightUtc(todayKey);
  const to = amsterdamMidnightUtc(addDaysToKey(todayKey, VIEW_DAYS[view]));
  const events = await getAgendaEvents({ from, to });

  // Group by day (events already sorted by start).
  const byDay = new Map<string, AgendaEvent[]>();
  for (const e of events) {
    const arr = byDay.get(e.dayKey) ?? [];
    arr.push(e);
    byDay.set(e.dayKey, arr);
  }
  const days = [...byDay.keys()].sort();

  // Lazy-issue the per-user calendar secret for the ICS feed.
  let [u] = await db
    .select({ secret: users.calendarTokenSecret })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u?.secret) {
    const secret = newCalendarSecret();
    await db.update(users).set({ calendarTokenSecret: secret, updatedAt: new Date() }).where(eq(users.id, session.user.id));
    u = { secret };
  }
  const token = deriveCalendarToken({ userId: session.user.id, secret: u.secret! });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
  const icsUrl = origin + "/admin/business/calendar.ics?token=" + token;

  return (
    <div className="max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Agenda</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Operations-agenda</h1>
      <p className="mt-2 text-sm text-ink-600">
        Wat staat er gepland — en waar koks tekortkomen. Open diensten openen direct de vul-lade.
      </p>

      {/* View switcher */}
      <div className="mt-5 inline-flex rounded-full border border-ink-200 bg-white p-0.5">
        {(["dag", "week", "maand"] as View[]).map((v) => (
          <Link
            key={v}
            href={`/admin/business/agenda?view=${v}`}
            className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.14em] ${
              v === view ? "bg-burgundy text-white" : "text-ink-600 hover:text-burgundy"
            }`}
          >
            {v === "dag" ? "Vandaag" : v === "week" ? "Week" : "Maand"}
          </Link>
        ))}
      </div>

      {/* Day-grouped agenda */}
      <div className="mt-5 space-y-5">
        {days.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
            <p className="font-serif text-lg text-emerald-800">Niets gepland in deze periode</p>
            <p className="mt-1 text-sm text-ink-600">Geen diensten of openstaande verzoeken.</p>
          </div>
        ) : (
          days.map((dayKey) => (
            <section key={dayKey} className="rounded-xl border border-ink-200 bg-white">
              <h2 className="border-b border-ink-100 px-5 py-3 font-serif text-base text-ink-900">
                {dayLabel(dayKey)}
              </h2>
              <ul className="divide-y divide-ink-100">
                {byDay.get(dayKey)!.map((e) => (
                  <li key={e.id}>
                    <Link href={e.href} className="flex items-start gap-3 px-5 py-3 hover:bg-bg-gray">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneDot(e.tone)}`} />
                      <span className="w-14 shrink-0 font-ui text-[11px] tabular-nums text-ink-500">{timeLabel(e.startsAt)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-ink-900">{e.title}</span>
                          {e.type === "open_shift" && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-800">Open</span>
                          )}
                          {e.type === "change_request" && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-blue-700">Verzoek</span>
                          )}
                        </span>
                        <span className="block text-xs text-ink-500">{e.subtitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* Phone subscription (ICS) */}
      <section className="mt-10 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Op je telefoon</h2>
        <p className="mt-1 text-sm text-ink-700">
          Abonneer op de operations-agenda — open plekken als <em>voorlopig</em>, bemande als{" "}
          <em>bevestigd</em>. Werkt zichzelf bij.
        </p>
        <div className="mt-3">
          <CopyUrlBlock url={icsUrl} />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.16em] text-ink-600">
            Hoe abonneer ik? · URL vernieuwen
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
            <li><strong>iPhone:</strong> Instellingen → Agenda → Accounts → Account toevoegen → Andere → Agenda-abonnement → plak de URL.</li>
            <li><strong>Google:</strong> calendar.google.com → toevoegen via URL → plak de URL.</li>
            <li><strong>Outlook:</strong> Agenda → Abonneren op online agenda → plak de URL.</li>
          </ol>
          <form action={rotateSecret} className="mt-3">
            <button type="submit" className="rounded-full border border-burgundy/40 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.16em] text-burgundy hover:bg-burgundy/5">
              URL vernieuwen (gelekt?)
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}

function toneDot(tone: AgendaTone): string {
  if (tone === "warn") return "bg-amber-400";
  if (tone === "good") return "bg-emerald-500";
  return "bg-ink-300";
}
function dayLabel(dayKey: string): string {
  const d = amsterdamMidnightUtc(dayKey);
  const s = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function timeLabel(d: Date): string {
  return new Date(d).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
