/**
 * /client/request — klant submits a shift request from inside the portal.
 *
 * PR-F3. Replaces the stub. Drops into the same client_submissions table
 * the Jotform webhooks use, so it shows up in the admin inbox alongside
 * external submissions with a "from portal" badge.
 *
 * Security:
 *   - requireClientSelf() resolves the client record via session.user.id
 *     → clients.userId. The user CANNOT supply a clientId in the form;
 *     the lookup is the auth.
 *   - Pre-fills the form with the authed client's known data (name,
 *     email, location) so they don't have to re-type.
 *   - Drops in with status='triaged' (skip "new" — this is a known client)
 *     so admin sees it with priority styling.
 *
 * Notification (PR-F1): fires routeFor('client_portal_request'). Empty
 * route = silent (still saved to DB).
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Resend } from "resend";

import { db } from "@/lib/db/client";
import { auditLog, clients, clientSubmissions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Nieuwe aanvraag" };
export const dynamic = "force-dynamic";

async function requireClientSelf(): Promise<{
  clientId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  segment: string | null;
}> {
  const session = await requireAuth("/client/request");
  const [c] = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      email: clients.email,
      phone: clients.phone,
      city: clients.city,
      segment: clients.segment,
    })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1);
  if (!c) redirect("/client");
  return {
    clientId: c.id,
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    city: c.city,
    segment: c.segment,
  };
}

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "keukenhulp", label: "Keukenhulp" },
  { value: "commis", label: "Commis chef" },
  { value: "chef_de_partie", label: "Chef de partie" },
  { value: "sous_chef", label: "Sous-chef" },
  { value: "chef_de_cuisine", label: "Chef de cuisine" },
  { value: "executive_chef", label: "Executive chef" },
  { value: "patissier", label: "Patissier" },
  { value: "banqueting", label: "Banqueting" },
  { value: "breakfast", label: "Breakfast" },
  { value: "roomservice", label: "Roomservice" },
  { value: "bediening", label: "Bediening" },
  { value: "host", label: "Host(ess)" },
  { value: "runner", label: "Runner" },
  { value: "other", label: "Anders (specificeer in opmerking)" },
];

const SEGMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "casual", label: "Casual / brasserie" },
  { value: "fine_dining", label: "Fine dining" },
  { value: "hotel", label: "Hotel" },
  { value: "banqueting", label: "Banqueting" },
  { value: "catering", label: "Catering" },
  { value: "event", label: "Event" },
  { value: "corporate", label: "Corporate" },
];

async function submitPortalRequest(formData: FormData) {
  "use server";
  const me = await requireClientSelf();

  const roleNeeded = String(formData.get("roleNeeded") ?? "").trim();
  const segment = String(formData.get("segment") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const headcountStr = String(formData.get("headcount") ?? "1").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const rateHint = String(formData.get("rateHint") ?? "").trim();

  // Light server-side validation. Client-side `required` handles most.
  if (!roleNeeded) redirect("/client/request?error=missing-role");
  if (!startDate) redirect("/client/request?error=missing-start");
  if (endDate && endDate < startDate) {
    redirect("/client/request?error=bad-dates");
  }
  const headcount = Math.max(1, Math.min(99, Number(headcountStr) || 1));

  const dateNeededDisplay = endDate && endDate !== startDate
    ? `${startDate} t/m ${endDate}`
    : startDate;

  const externalId = `portal-${me.clientId}-${Date.now()}`;

  const submission = {
    externalId,
    source: "client_portal",
    rawPayload: {
      via: "client_portal",
      submittedByClientId: me.clientId,
      roleNeeded,
      segment,
      startDate,
      endDate,
      headcount,
      notes,
      rateHint,
    },
    companyName: me.companyName,
    contactName: me.contactName,
    email: me.email,
    phone: me.phone,
    roleRequested: roleNeeded,
    segment: segment || me.segment,
    dateNeeded: dateNeededDisplay,
    headcount,
    location: me.city,
    notes,
    // Known-client request — skip "new" triage step
    status: "triaged" as const,
  };

  const [row] = await db
    .insert(clientSubmissions)
    .values(submission)
    .returning({ id: clientSubmissions.id });

  await db.insert(auditLog).values({
    action: "client.portal_request_submitted",
    resource: "client_submissions",
    resourceId: row?.id ?? null,
    after: {
      clientId: me.clientId,
      roleNeeded,
      segment,
      headcount,
      startDate,
      endDate,
    },
  });

  // Fire notification (best-effort — PR-F1 routes).
  const to = await recipientsFor("client_portal_request");
  if (to.length > 0) {
    const subject = `🏨 Portaal-aanvraag: ${me.companyName} — ${roleNeeded}`;
    const text = [
      `Klant: ${me.companyName}`,
      `Contactpersoon: ${me.contactName ?? "—"}`,
      `Rol: ${roleNeeded}`,
      `Segment: ${segment || me.segment || "—"}`,
      `Wanneer: ${dateNeededDisplay}`,
      `Aantal: ${headcount}`,
      `Tarief-hint: ${rateHint || "—"}`,
      `Locatie: ${me.city ?? "—"}`,
      "",
      `Opmerking: ${notes || "—"}`,
      "",
      `Bekijk: ${env.NEXT_PUBLIC_APP_URL}/admin/business/inbox`,
    ].join("\n");
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject,
        text,
      });
    } catch {
      // notifications are best-effort; submission already saved
    }
  }

  redirect("/client/request?ok=1");
}

export default async function ClientRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const me = await requireClientSelf();
  const params = await searchParams;

  const todayIso = new Date().toISOString().slice(0, 10);

  const errorMsg =
    params.error === "missing-role"
      ? "Selecteer welke rol je nodig hebt."
      : params.error === "missing-start"
        ? "Vul een startdatum in."
        : params.error === "bad-dates"
          ? "Einddatum kan niet vóór de startdatum liggen."
          : null;

  if (params.ok === "1") {
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 md:p-10">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-2xl font-bold leading-none text-white"
            >
              ✓
            </span>
            <div>
              <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-emerald-800">
                Aanvraag ontvangen
              </p>
              <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
                Bedankt — we hebben je aanvraag binnen
              </h1>
              <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
                Maarten of Gina kijkt er binnen <strong>4 werkuren</strong>
                {" "}naar en stuurt je voorstellen via e-mail naar{" "}
                <strong>{me.email ?? "je opgegeven e-mailadres"}</strong>.
                Spoed? Bel het kantoor.
              </p>
              <p className="mt-3 text-xs text-ink-500">
                Je vindt deze aanvraag terug onder &ldquo;Mijn shifts&rdquo;
                zodra er een voorstel is.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/client/request"
            className="inline-block rounded-full bg-burgundy px-5 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
          >
            Nog een aanvraag indienen
          </Link>
          <Link
            href="/client/shifts"
            className="inline-block rounded-full border border-burgundy/30 px-5 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
          >
            Mijn shifts bekijken
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Nieuwe aanvraag
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Vraag personeel aan
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Vertel ons wat je nodig hebt. Wij matchen handmatig binnen 4-24 uur en
        sturen voorstellen naar <strong>{me.email ?? "het opgegeven e-mailadres"}</strong>.
        Sneller? Bel het kantoor.
      </p>

      <form action={submitPortalRequest} className="mt-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Welke rol *
            </span>
            <select
              name="roleNeeded"
              required
              defaultValue=""
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="" disabled>
                Kies een rol…
              </option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Segment / sfeer
            </span>
            <select
              name="segment"
              defaultValue={me.segment ?? ""}
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="">— (zelfde als jouw profiel)</option>
              {SEGMENT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label>
            <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Startdatum *
            </span>
            <input
              type="date"
              name="startDate"
              required
              min={todayIso}
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </label>

          <label>
            <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Einddatum
            </span>
            <input
              type="date"
              name="endDate"
              min={todayIso}
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </label>

          <label>
            <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Aantal personen
            </span>
            <input
              type="number"
              name="headcount"
              min={1}
              max={99}
              defaultValue={1}
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Tarief-indicatie (optioneel)
          </span>
          <input
            type="text"
            name="rateHint"
            placeholder="bijv. €35-40 per uur"
            className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Opmerking — waar gaat het om?
          </span>
          <textarea
            name="notes"
            rows={4}
            placeholder="Wat voor avond, brigade-grootte, allergieën, voorkeur voor specifieke chef…"
            className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        {errorMsg ? (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        ) : null}

        <button
          type="submit"
          className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Aanvraag indienen
        </button>
      </form>

      <p className="mt-10 text-xs leading-relaxed text-ink-500">
        Door dit formulier in te dienen verzend je een aanvraag — er wordt
        geen contract automatisch gesloten. Maarten of Gina neemt contact
        op met een voorstel.
      </p>
    </div>
  );
}
