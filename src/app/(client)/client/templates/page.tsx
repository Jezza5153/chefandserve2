/**
 * /client/templates — the klant's "Vaste shifts" (PR-KLANT-4).
 *
 * Reads like a weekly agreement, not admin data. The klant can request a
 * change (rate, time, pause) which lands in client_change_requests with
 * field='template:<id>' so admin sees it in the same Wijzigingsverzoeken tab.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { fieldClass } from "@/components/forms/Fields";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  clientChangeRequests,
  clients,
  shiftTemplateExceptions,
  shiftTemplates,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";
import {
  formatPattern,
  formatIsoDate,
  previewDates,
} from "@/lib/shift-template-format";

export const metadata = { title: "Vaste shifts", robots: { index: false } };
export const dynamic = "force-dynamic";

async function getOwnClient(userId: string) {
  const [c] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  return c ?? null;
}

async function requestTemplateChange(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const c = await getOwnClient(session.user.id);
  if (!c) redirect("/client/templates?err=no-profile");

  const templateId = String(formData.get("templateId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!templateId || reason.length < 5) {
    redirect("/client/templates?err=incomplete");
  }

  // Ownership: the template must belong to this client.
  const [own] = await db
    .select({ id: shiftTemplates.id })
    .from(shiftTemplates)
    .where(and(eq(shiftTemplates.id, templateId), eq(shiftTemplates.clientId, c.id)))
    .limit(1);
  if (!own) redirect("/client/templates?err=not_found");

  const [req] = await db
    .insert(clientChangeRequests)
    .values({
      clientId: c.id,
      field: `template:${templateId}`,
      currentValue: null,
      proposedValue: null,
      reason,
    })
    .returning({ id: clientChangeRequests.id });

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "client.template_change_requested",
    resource: "client_change_requests",
    resourceId: req.id,
    after: { templateId, reason },
  });

  const adminEmails = await recipientsFor("client_portal_request");
  if (adminEmails.length > 0) {
    const send = await sendEmail({
      to: adminEmails,
      subject: `Template-wijziging aangevraagd door ${c.companyName}`,
      react: (
        <div>
          <h1>{`${c.companyName} wil een vaste-shift template wijzigen`}</h1>
          <p>
            <strong>Template:</strong> {templateId}
            <br />
            <strong>Reden:</strong> {reason}
          </p>
          <p>
            Open in admin:{" "}
            <a href={`${process.env.NEXT_PUBLIC_APP_URL}/admin/business/templates/${templateId}`}>
              template-detail
            </a>
            .
          </p>
        </div>
      ),
    });
    if (send.ok) {
      for (const to of adminEmails) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: to,
          template: "ClientTemplateChangeAdminInline",
          eventKey: "client_portal_request",
          entityType: "client_change_requests",
          entityId: req.id,
        });
      }
    }
  }

  redirect("/client/templates?ok=requested");
}

export default async function ClientTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await requireAuth("/client/templates");
  const sp = await searchParams;
  const c = await getOwnClient(session.user.id);
  if (!c) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">Mail het kantoor.</p>
      </div>
    );
  }

  const templates = await db
    .select()
    .from(shiftTemplates)
    .where(and(eq(shiftTemplates.clientId, c.id), eq(shiftTemplates.active, true)))
    .orderBy(asc(shiftTemplates.dayOfWeek));

  // Exceptions per template (for accurate next-date display) — own templates only
  // (data-minimization: an unbounded select pulled every client's exceptions).
  const exRows = templates.length
    ? await db
        .select()
        .from(shiftTemplateExceptions)
        .where(inArray(shiftTemplateExceptions.templateId, templates.map((t) => t.id)))
    : [];
  const exByTemplate = new Map<string, Set<string>>();
  for (const e of exRows) {
    if (!exByTemplate.has(e.templateId)) exByTemplate.set(e.templateId, new Set());
    exByTemplate.get(e.templateId)!.add(e.date);
  }

  const flashOk = sp.ok === "requested" ? "✓ Verzoek verstuurd naar Chef & Serve." : null;
  const flashErr =
    sp.err === "incomplete"
      ? "Vul een toelichting in (min 5 tekens)."
      : sp.err
        ? "Er ging iets mis."
        : null;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Vaste shifts
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Jouw wekelijkse afspraken
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Vaste shifts die Chef &amp; Serve voor je inplant. Wil je iets
        aanpassen? Stuur een verzoek — wij regelen het.
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

      {templates.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
          Je hebt nog geen vaste shifts. Wil je er een afspreken? Neem contact
          op met Chef &amp; Serve.
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {templates.map((t) => {
            const next = previewDates(
              t.dayOfWeek,
              t.generateHorizonDays,
              exByTemplate.get(t.id) ?? new Set(),
            ).slice(0, 4);
            return (
              <li key={t.id} className="rounded-lg border border-ink-200 bg-white p-5">
                <p className="font-serif text-lg text-ink-900">
                  {formatPattern({
                    dayOfWeek: t.dayOfWeek,
                    startsAtTime: t.startsAtTime,
                    endsAtTime: t.endsAtTime,
                    endsNextDay: t.endsNextDay,
                  })}
                </p>
                <p className="mt-0.5 text-sm text-ink-700">
                  {t.roleNeeded} · {t.headcount} chef{t.headcount === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  Tariefafspraak: via Chef &amp; Serve · Status: actief
                </p>
                {next.length > 0 ? (
                  <p className="mt-2 text-xs text-ink-500">
                    Volgende shifts: {next.map((iso) => formatIsoDate(iso)).join(" · ")}
                  </p>
                ) : null}

                <details className="mt-3">
                  <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline">
                    Wijziging aanvragen
                  </summary>
                  <form action={requestTemplateChange} className="mt-2">
                    <input type="hidden" name="templateId" value={t.id} />
                    <textarea
                      name="reason"
                      rows={3}
                      required
                      minLength={5}
                      placeholder="Bijv. ‘graag 30 min later starten’ of ‘pauzeren in juli’"
                      className={`${fieldClass} placeholder-ink-500`}
                    />
                    <button
                      type="submit"
                      className="mt-2 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
                    >
                      Verzoek versturen
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
