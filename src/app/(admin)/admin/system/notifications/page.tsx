/**
 * /admin/system/notifications — per-event routing config.
 *
 * Super_admin only. Each event row shows current recipients (comma-separated
 * input), enabled toggle, last updater. Saves write the table + invalidate
 * the 60s cache.
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { auditLog, notificationRoutes, users } from "@/lib/db/schema";
import {
  ALL_EVENTS,
  EVENT_LABELS,
  invalidateCache,
  routeFor,
  type NotificationEvent,
} from "@/lib/notifications";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Notifications", robots: { index: false } };
export const dynamic = "force-dynamic";

async function saveRoute(formData: FormData) {
  "use server";
  const session = await requireRole("super_admin");
  const event = String(formData.get("event") ?? "") as NotificationEvent;
  const recipientsRaw = String(formData.get("recipients") ?? "");
  const enabled = formData.get("enabled") === "on";

  if (!ALL_EVENTS.includes(event)) {
    redirect("/admin/system/notifications?error=bad-event");
  }

  // Parse + normalize: split on comma/whitespace, lowercase, dedupe, validate.
  const recipients = Array.from(
    new Set(
      recipientsRaw
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),
  );
  for (const r of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) {
      redirect(
        `/admin/system/notifications?error=bad-email&event=${event}`,
      );
    }
  }

  // Read prior state for audit "before"
  const [prior] = await db
    .select()
    .from(notificationRoutes)
    .where(eq(notificationRoutes.event, event))
    .limit(1);

  await db
    .insert(notificationRoutes)
    .values({
      event,
      recipients,
      enabled,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationRoutes.event,
      set: {
        recipients,
        enabled,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "notification.route_updated",
    resource: "notification_routes",
    resourceId: event,
    before: prior ? { recipients: prior.recipients, enabled: prior.enabled } : null,
    after: { recipients, enabled },
  });

  invalidateCache(event);
  redirect(`/admin/system/notifications?saved=${event}`);
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; event?: string }>;
}) {
  await requireRole("super_admin");
  const params = await searchParams;

  const rows = await Promise.all(
    ALL_EVENTS.map(async (event) => {
      const r = await routeFor(event);
      return { event, ...r };
    }),
  );

  // Last-updater email lookup for display
  const dbRows = await db
    .select({
      event: notificationRoutes.event,
      updatedAt: notificationRoutes.updatedAt,
      updatedByEmail: users.email,
    })
    .from(notificationRoutes)
    .leftJoin(users, eq(users.id, notificationRoutes.updatedBy));
  const meta = new Map(
    dbRows.map((r) => [
      r.event,
      { updatedAt: r.updatedAt, email: r.updatedByEmail },
    ]),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System · notifications
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Notificatie-routes
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-700 md:text-base">
        Per gebeurtenis een lijst van ontvangers. Lege of uitgeschakelde
        routes versturen niets — events worden wel ge-audit. Standaardwaarden
        (uit env-vars) worden gebruikt zolang er geen rij in de tabel staat.
        Wijzigingen actief binnen 60 seconden.
      </p>

      {params.saved ? (
        <p className="mt-6 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Opgeslagen voor <strong>{params.saved}</strong>.
        </p>
      ) : null}
      {params.error === "bad-email" ? (
        <p className="mt-6 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          Een van de e-mailadressen is niet geldig. Gebruik komma of spatie
          tussen meerdere adressen.
        </p>
      ) : null}

      <div className="mt-10 space-y-4">
        {rows.map((r) => {
          const m = meta.get(r.event);
          return (
            <form
              key={r.event}
              action={saveRoute}
              className="rounded-lg border border-ink-200 bg-white p-5"
            >
              <input type="hidden" name="event" value={r.event} />

              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="font-serif text-lg text-ink-900">
                    {EVENT_LABELS[r.event]}
                  </h2>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
                    {r.event}
                  </p>
                </div>
                {m ? (
                  <p className="text-[11px] text-ink-500">
                    Laatst bewerkt {new Date(m.updatedAt).toLocaleDateString("nl-NL")}
                    {m.email ? ` door ${m.email}` : ""}
                  </p>
                ) : (
                  <span className="rounded-full bg-bg-gray px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-ink-500">
                    Standaard (env)
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label>
                  <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Ontvangers
                  </span>
                  <input
                    type="text"
                    name="recipients"
                    defaultValue={r.recipients.join(", ")}
                    placeholder="maarten@chefandserve.nl, gina@chefandserve.nl"
                    className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-xs text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-700">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={r.enabled}
                    className="size-4 rounded border-ink-200 text-burgundy focus:ring-burgundy"
                  />
                  Aan
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-ink-500">
                  Komma of spatie als scheiding tussen adressen.
                </p>
                <button
                  type="submit"
                  className="rounded-full bg-burgundy px-5 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white transition-colors hover:bg-burgundy-900"
                >
                  Opslaan
                </button>
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
