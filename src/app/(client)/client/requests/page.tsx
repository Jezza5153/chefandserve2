/**
 * /client/requests — PR-KLANT-2.
 *
 * Two lists so the klant always knows where things stand and never feels
 * trapped:
 *   A. Mijn aanvragen — portal submissions (with status, next step, and a
 *      retract action while still new/triaged).
 *   B. Wijzigings- & annuleringsverzoeken — change/cancel requests filed on
 *      existing shifts, with their decision status.
 *
 * Ownership is the auth lookup (session.user.id → clients.userId). Submissions
 * have no clientId FK yet, so "mine" = source='client_portal' + companyName
 * match (same rule as the dashboard).
 */

import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  RequestStatusBadge,
  requestStatusNextStep,
} from "../_components/RequestStatusBadge";
import { fieldClass } from "@/components/forms/Fields";
import { db } from "@/lib/db/client";
import {
  clientShiftChangeRequests,
  clientSubmissions,
  clients,
  shifts,
} from "@/lib/db/schema";
import { cancelClientSubmission } from "@/lib/domain/shift-change-requests";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Mijn aanvragen", robots: { index: false } };
export const dynamic = "force-dynamic";

async function getOwnClient(userId: string) {
  const [c] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  return c ?? null;
}

async function cancelSubmission(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const c = await getOwnClient(session.user.id);
  if (!c) redirect("/client/requests?err=no-profile");

  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!submissionId) redirect("/client/requests");

  const res = await cancelClientSubmission({
    submissionId,
    client: c,
    requestedBy: session.user.id,
    reason,
  });
  redirect(
    res.ok ? "/client/requests?ok=cancelled" : `/client/requests?err=${res.error}`,
  );
}

export default async function ClientRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await requireAuth("/client/requests");
  const sp = await searchParams;
  const c = await getOwnClient(session.user.id);
  if (!c) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">
          Er is nog geen klant-profiel aan je account gekoppeld. Mail het kantoor.
        </p>
      </div>
    );
  }

  // A. Portal submissions that are "mine"
  const submissions = await db
    .select()
    .from(clientSubmissions)
    .where(
      and(
        eq(clientSubmissions.source, "client_portal"),
        // PR-AUDIT-1: scope by owner FK, not the non-unique companyName.
        eq(clientSubmissions.clientId, c.id),
      ),
    )
    .orderBy(desc(clientSubmissions.createdAt))
    .limit(50);

  // B. Shift change/cancel requests
  const shiftRequests = await db
    .select({
      r: clientShiftChangeRequests,
      shiftRole: shifts.roleNeeded,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
    })
    .from(clientShiftChangeRequests)
    .innerJoin(shifts, eq(shifts.id, clientShiftChangeRequests.shiftId))
    .where(eq(clientShiftChangeRequests.clientId, c.id))
    .orderBy(desc(clientShiftChangeRequests.createdAt))
    .limit(50);

  const flashOk = sp.ok === "cancelled" ? "✓ Aanvraag ingetrokken." : null;
  const flashErr =
    sp.err === "wrong_status"
      ? "Deze aanvraag is al in behandeling genomen en kan niet meer worden ingetrokken. Bel ons gerust."
      : sp.err === "not_owner"
        ? "Deze aanvraag hoort niet bij jouw account."
        : sp.err === "no-profile"
          ? "Geen klant-profiel gevonden."
          : null;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn aanvragen
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Aanvragen &amp; verzoeken
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        De status van alles wat je hebt aangevraagd — en wat de volgende stap is.
      </p>

      {flashOk ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {flashErr}
        </p>
      ) : null}

      {/* A. Submissions */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Personeelsaanvragen ({submissions.length})
          </h2>
          <Link
            href="/client/request"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            + Nieuwe aanvraag
          </Link>
        </div>

        {submissions.length === 0 ? (
          <div className="mt-3 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Nog geen aanvragen. Dien je eerste aanvraag in via &ldquo;Nieuwe
            aanvraag&rdquo;.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {submissions.map((s) => {
              const canCancel = s.status === "new" || s.status === "triaged";
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-ink-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-base text-ink-900">
                        {s.roleRequested ?? "Personeelsaanvraag"}
                        {s.headcount ? ` · ${s.headcount} pers.` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {s.dateNeeded ?? "Datum n.t.b."}
                      </p>
                      <p className="mt-1 text-xs text-ink-700">
                        {requestStatusNextStep(s.status)}
                      </p>
                    </div>
                    <RequestStatusBadge status={s.status} />
                  </div>

                  {canCancel ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline">
                        Aanvraag intrekken
                      </summary>
                      <form action={cancelSubmission} className="mt-2">
                        <input type="hidden" name="submissionId" value={s.id} />
                        <textarea
                          name="reason"
                          rows={2}
                          placeholder="Reden (optioneel) — helpt ons je beter te begrijpen"
                          className={`${fieldClass} placeholder-ink-500`}
                        />
                        <button
                          type="submit"
                          className="mt-2 rounded-full border border-red-300 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                        >
                          Bevestig intrekken
                        </button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* B. Shift change/cancel requests */}
      {shiftRequests.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Wijzigings- &amp; annuleringsverzoeken ({shiftRequests.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {shiftRequests.map(({ r, shiftRole, shiftStart }) => (
              <li
                key={r.id}
                className="rounded-lg border border-ink-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-base text-ink-900">
                      {r.kind === "cancel" ? "Annulering" : "Wijziging"} ·{" "}
                      {shiftRole}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {new Date(shiftStart).toLocaleDateString("nl-NL", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                    <p className="mt-1 text-xs text-ink-700">{r.reason}</p>
                    {r.decisionNotes ? (
                      <p className="mt-1 text-xs text-ink-500">
                        Reactie Chef &amp; Serve: {r.decisionNotes}
                      </p>
                    ) : null}
                  </div>
                  <ShiftRequestPill status={r.status} />
                </div>
                <Link
                  href={`/client/shifts/${r.shiftId}`}
                  className="mt-2 inline-block font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline"
                >
                  Bekijk shift →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ShiftRequestPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Aangevraagd",
    in_progress: "In behandeling",
    approved: "Doorgevoerd",
    rejected: "Niet doorgevoerd",
  };
  const tone =
    status === "approved"
      ? "bg-emerald-100 text-emerald-700"
      : status === "rejected"
        ? "bg-bg-gray text-ink-500"
        : "bg-amber-100 text-amber-800";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
