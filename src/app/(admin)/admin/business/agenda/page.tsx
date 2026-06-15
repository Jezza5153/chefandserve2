/**
 * /admin/business/agenda — owner Agenda (P2a subscribe + P2c grid + P2-finish/P2d).
 *
 * Day/week/month operations agenda: shifts + pending change-requests + manual one-off
 * events (intake calls, follow-ups, …), with a client-lens / chef-lens. Open shifts
 * deep-link into the dashboard "Vul deze dienst" drawer; manual events render inline as
 * interactive cards (intake/prep checklist + afronden/annuleren). Below: a "Nieuwe
 * afspraak" form and the phone-subscribable ICS feed.
 */

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";

import { CopyUrlBlock } from "@/components/CopyUrlBlock";
import { db } from "@/lib/db/client";
import { chefs, clients, users } from "@/lib/db/schema";
import { deriveCalendarToken, newCalendarSecret } from "@/lib/calendar/ics";
import { getAgendaEvents, type AgendaEvent, type AgendaTone } from "@/lib/domain/agenda";
import { AGENDA_EVENT_KINDS, agendaEventLabel } from "@/lib/domain/agenda-events";
import { amsterdamDayKey, amsterdamMidnightUtc, addDaysToKey } from "@/lib/roster-format";
import { requirePermission } from "@/lib/permissions";
import {
  createAgendaEventAction,
  completeAgendaEventAction,
  cancelAgendaEventAction,
  toggleChecklistItemAction,
} from "./_actions";

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
  searchParams: Promise<{ view?: string; client?: string; chef?: string; done?: string }>;
}) {
  const session = await requirePermission("cockpit", "read");
  const sp = await searchParams;
  const view: View = sp.view === "dag" || sp.view === "maand" ? sp.view : "week";
  const lensClient = (sp.client ?? "").trim() || undefined;
  const lensChef = (sp.chef ?? "").trim() || undefined;

  // Window in Amsterdam time.
  const now = new Date();
  const todayKey = amsterdamDayKey(now);
  const from = amsterdamMidnightUtc(todayKey);
  const to = amsterdamMidnightUtc(addDaysToKey(todayKey, VIEW_DAYS[view]));

  // Lens lists (bounded for this agency); active-lens labels resolved from them.
  const [clientList, chefList, events] = await Promise.all([
    db.select({ id: clients.id, name: clients.companyName }).from(clients).orderBy(asc(clients.companyName)),
    db.select({ id: chefs.id, name: chefs.fullName }).from(chefs).orderBy(asc(chefs.fullName)),
    getAgendaEvents({ from, to, clientId: lensClient, chefId: lensChef }),
  ]);
  const lensClientName = lensClient ? clientList.find((c) => c.id === lensClient)?.name ?? null : null;
  const lensChefName = lensChef ? chefList.find((c) => c.id === lensChef)?.name ?? null : null;

  // Group by day (events already sorted by start).
  const byDay = new Map<string, AgendaEvent[]>();
  for (const e of events) {
    const arr = byDay.get(e.dayKey) ?? [];
    arr.push(e);
    byDay.set(e.dayKey, arr);
  }
  const days = [...byDay.keys()].sort();

  // Hidden fields that preserve the active view + lens across action redirects.
  const ctx = { view, lensClient: lensClient ?? "", lensChef: lensChef ?? "" };

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

  // Preserve lens when switching views.
  const viewHref = (v: View) => {
    const p = new URLSearchParams();
    p.set("view", v);
    if (lensClient) p.set("client", lensClient);
    if (lensChef) p.set("chef", lensChef);
    return "/admin/business/agenda?" + p.toString();
  };

  return (
    <div className="max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Agenda</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Operations-agenda</h1>
      <p className="mt-2 text-sm text-ink-600">
        Wat staat er gepland — en waar koks tekortkomen. Open diensten openen direct de vul-lade.
      </p>

      {sp.done && <AgendaFlash done={sp.done} />}

      {/* View switcher */}
      <div role="group" aria-label="Agendaweergave" className="mt-5 inline-flex rounded-full border border-ink-200 bg-white p-0.5">
        {(["dag", "week", "maand"] as View[]).map((v) => (
          <Link
            key={v}
            href={viewHref(v)}
            aria-current={v === view ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.14em] ${
              v === view ? "bg-burgundy text-white" : "text-ink-600 hover:text-burgundy"
            }`}
          >
            {v === "dag" ? "Vandaag" : v === "week" ? "Week" : "Maand"}
          </Link>
        ))}
      </div>

      {/* Lens bar — scope to one client or one chef */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {lensClientName || lensChefName ? (
          <>
            <span className="rounded-full bg-burgundy/10 px-3 py-1 font-ui text-[11px] font-medium uppercase tracking-[0.12em] text-burgundy">
              {lensClientName ? "Klant: " + lensClientName : "Kok: " + lensChefName}
            </span>
            <Link href={viewHref(view).split("&")[0]} className="font-ui text-[11px] uppercase tracking-[0.12em] text-ink-500 hover:text-burgundy">
              Toon alles
            </Link>
          </>
        ) : (
          <>
            <form method="get" className="flex items-center gap-1.5">
              <input type="hidden" name="view" value={view} />
              <label className="sr-only" htmlFor="lens-client">Filter op klant</label>
              <select id="lens-client" name="client" defaultValue="" className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[12px] text-ink-700">
                <option value="">Filter op klant…</option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? "Onbekend"}</option>
                ))}
              </select>
              <LensGo />
            </form>
            <form method="get" className="flex items-center gap-1.5">
              <input type="hidden" name="view" value={view} />
              <label className="sr-only" htmlFor="lens-chef">Filter op kok</label>
              <select id="lens-chef" name="chef" defaultValue="" className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[12px] text-ink-700">
                <option value="">Filter op kok…</option>
                {chefList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name ?? "Onbekend"}</option>
                ))}
              </select>
              <LensGo />
            </form>
          </>
        )}
      </div>

      {/* Day-grouped agenda */}
      <div className="mt-5 space-y-5">
        {days.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
            <p className="font-serif text-lg text-emerald-800">Niets gepland in deze periode</p>
            <p className="mt-1 text-sm text-ink-600">Geen diensten, verzoeken of afspraken.</p>
          </div>
        ) : (
          days.map((dayKey) => (
            <section key={dayKey} className="rounded-xl border border-ink-200 bg-white">
              <h2 className="border-b border-ink-100 px-5 py-3 font-serif text-base text-ink-900">
                {dayLabel(dayKey)}
              </h2>
              <ul className="divide-y divide-ink-100">
                {byDay.get(dayKey)!.map((e) =>
                  e.type === "manual" ? (
                    <ManualRow key={e.id} e={e} ctx={ctx} />
                  ) : (
                    <li key={e.id}>
                      <Link href={e.href} className="flex items-start gap-3 px-5 py-3 hover:bg-bg-gray">
                        <span aria-hidden="true" className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneDot(e.tone)}`} />
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
                  ),
                )}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* Nieuwe afspraak (manual event) */}
      <section className="mt-8 rounded-xl border border-ink-200 bg-white">
        <details>
          <summary className="cursor-pointer px-5 py-3 font-serif text-base text-ink-900">+ Nieuwe afspraak</summary>
          <form action={createAgendaEventAction} className="space-y-3 border-t border-ink-100 px-5 py-4">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="lensClient" value={ctx.lensClient} />
            <input type="hidden" name="lensChef" value={ctx.lensChef} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select name="type" defaultValue="intake_call" className={inputCls}>
                  {AGENDA_EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>{agendaEventLabel(k)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Titel">
                <input name="title" required maxLength={200} placeholder="bijv. Intake Hotel Okura" className={inputCls} />
              </Field>
              <Field label="Wanneer">
                <input name="startsAt" type="datetime-local" required className={inputCls} />
              </Field>
              <Field label="Tot (optioneel)">
                <input name="endsAt" type="datetime-local" className={inputCls} />
              </Field>
              <Field label="Klant (optioneel)">
                <select name="linkedClientId" defaultValue="" className={inputCls}>
                  <option value="">—</option>
                  {clientList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? "Onbekend"}</option>
                  ))}
                </select>
              </Field>
              <Field label="Kok (optioneel)">
                <select name="linkedChefId" defaultValue="" className={inputCls}>
                  <option value="">—</option>
                  {chefList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? "Onbekend"}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Notitie (optioneel)">
              <textarea name="notes" rows={2} className={inputCls} placeholder="Context, agenda, te bespreken punten…" />
            </Field>
            <Field label="Checklist (optioneel — één per regel)">
              <textarea name="checklist" rows={3} className={inputCls} placeholder={"Contract sturen\nMenu doornemen\nAllergieën checken"} />
            </Field>
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
            >
              Afspraak opslaan
            </button>
          </form>
        </details>
      </section>

      {/* Phone subscription (ICS) */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-serif text-lg text-ink-900">Op je telefoon</h2>
        <p className="mt-1 text-sm text-ink-700">
          Abonneer op de operations-agenda — open plekken als <em>voorlopig</em>, bemande als{" "}
          <em>bevestigd</em>, plus je intakes en herinneringen. Werkt zichzelf bij.
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

/* ---- manual-event row: inline interactive card ---- */
function ManualRow({ e, ctx }: { e: AgendaEvent; ctx: { view: string; lensClient: string; lensChef: string } }) {
  const m = e.manual!;
  const checked = m.checklist ? m.checklist.filter((c) => c.done).length : 0;
  const total = m.checklist?.length ?? 0;
  return (
    <li className="px-5 py-3">
      <details>
        <summary className="flex cursor-pointer items-start gap-3 list-none">
          <span aria-hidden="true" className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneDot(e.tone)}`} />
          <span className="w-14 shrink-0 font-ui text-[11px] tabular-nums text-ink-500">{timeLabel(e.startsAt)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-900">{e.title}</span>
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-violet-700">{m.kindLabel}</span>
              {m.status === "done" && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700">Afgerond</span>
              )}
            </span>
            <span className="block text-xs text-ink-500">{e.subtitle}</span>
          </span>
        </summary>

        <div className="mt-3 space-y-3 pl-[6.25rem]">
          {m.notes && <p className="whitespace-pre-wrap text-sm text-ink-700">{m.notes}</p>}

          {m.checklist && total > 0 && (
            <ul className="space-y-1.5">
              {m.checklist.map((it, i) => (
                <li key={i}>
                  <form action={toggleChecklistItemAction} className="flex items-center gap-2">
                    <input type="hidden" name="eventId" value={m.eventId} />
                    <input type="hidden" name="index" value={i} />
                    <input type="hidden" name="view" value={ctx.view} />
                    <input type="hidden" name="lensClient" value={ctx.lensClient} />
                    <input type="hidden" name="lensChef" value={ctx.lensChef} />
                    <button
                      type="submit"
                      aria-pressed={it.done}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        it.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink-300 bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </button>
                    <span className={`text-sm ${it.done ? "text-ink-400 line-through" : "text-ink-700"}`}>{it.label}</span>
                  </form>
                </li>
              ))}
              <li className="text-[11px] text-ink-400">{checked}/{total} afgevinkt</li>
            </ul>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {m.status !== "done" && (
              <form action={completeAgendaEventAction}>
                <Ctx ctx={ctx} eventId={m.eventId} />
                <button type="submit" className="rounded-full bg-burgundy px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">
                  Markeer afgerond
                </button>
              </form>
            )}
            <form action={cancelAgendaEventAction}>
              <Ctx ctx={ctx} eventId={m.eventId} />
              <button type="submit" className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-ink-600 hover:border-burgundy hover:text-burgundy">
                Annuleren
              </button>
            </form>
          </div>
        </div>
      </details>
    </li>
  );
}

function Ctx({ ctx, eventId }: { ctx: { view: string; lensClient: string; lensChef: string }; eventId: string }) {
  return (
    <>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="view" value={ctx.view} />
      <input type="hidden" name="lensClient" value={ctx.lensClient} />
      <input type="hidden" name="lensChef" value={ctx.lensChef} />
    </>
  );
}

const inputCls = "w-full rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-900 focus:border-burgundy focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function LensGo() {
  return (
    <button type="submit" className="rounded-md border border-ink-200 bg-white px-2.5 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:border-burgundy hover:text-burgundy">
      Toon
    </button>
  );
}

function AgendaFlash({ done }: { done: string }) {
  const MAP: Record<string, string> = {
    "agenda-aangemaakt": "✓ Afspraak toegevoegd aan de agenda.",
    "agenda-afgerond": "✓ Afspraak afgerond.",
    "agenda-geannuleerd": "✓ Afspraak geannuleerd.",
    "agenda-ongewijzigd": "Niets gewijzigd — de afspraak stond al zo.",
    "agenda-onvolledig": "Kon de afspraak niet opslaan — type, titel en tijd zijn verplicht.",
  };
  const msg = MAP[done];
  if (!msg) return null;
  const bad = done === "agenda-onvolledig";
  return (
    <div className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${bad ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
      {msg}
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
