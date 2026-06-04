/**
 * /client/profile — PR-KLANT-1 rebuild: sectioned + editable.
 *
 * Two authority zones (field authority documented in
 * docs/ai/source-of-truth-map.md):
 *
 *   DIRECT EDITABLE (klant writes immediately):
 *     contactName · phone · email (communicatie) · shiftAddress · city ·
 *     shiftArrivalNotes · billingEmail
 *     → editing shiftAddress/city affects only FUTURE requests/templates;
 *       existing shifts snapshot their own location (correction round 3, #2).
 *     → changing billingEmail emails the OLD address (anti-takeover).
 *
 *   REQUEST CHANGE (admin approves — finance + structural):
 *     companyName · kvk · btw · paymentTermsDays · billingAddress · authEmail
 *     → INSERT client_change_requests + admin email
 *
 * Server actions:
 *   saveClientProfile(formData)    — direct edit, audit + outbox
 *   requestClientChange(formData)  — INSERT client_change_requests + admin email
 */

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { ClientProfileForm } from "./ClientProfileForm";
import { ClientRequestChangeFormSection } from "./ClientRequestChangeFormSection";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  clientChangeRequests,
  clients,
  users,
} from "@/lib/db/schema";
import { CLIENT_TAG_OPTIONS, CLIENT_TYPE_OPTIONS } from "@/lib/domain/client-taxonomy";
import { BillingEmailChangedKlantEmail } from "@/emails/BillingEmailChangedKlantEmail";
import { sendEmail } from "@/lib/email";
import { enqueueIntegrationEvent, recordEmailMessage } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Mijn klantprofiel" };
export const dynamic = "force-dynamic";

/** Resolve the klant row for the current session, or null. */
async function getOwnClient(userId: string) {
  const [c] = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  return c ?? null;
}

const REQUESTABLE_FIELDS = [
  "companyName",
  "kvk",
  "btw",
  "paymentTermsDays",
  "billingAddress",
  "authEmail",
] as const;
type RequestableField = (typeof REQUESTABLE_FIELDS)[number];

async function saveClientProfile(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const c = await getOwnClient(session.user.id);
  if (!c) redirect("/client/profile?error=no-profile");

  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const contactName = get("contactName");
  const phone = get("phone");
  const email = get("email")?.toLowerCase() ?? null;
  const shiftAddress = get("shiftAddress");
  const city = get("city");
  const shiftArrivalNotes = get("shiftArrivalNotes");
  const billingEmail = get("billingEmail")?.toLowerCase() ?? null;

  // Descriptive venue preferences (non-binding match signal — NOT chef selection).
  // Validated against the shared taxonomy so the stored signal stays structured.
  const validTypes = new Set(CLIENT_TYPE_OPTIONS.map((o) => o.value as string));
  const validTags = new Set(CLIENT_TAG_OPTIONS.map((o) => o.value as string));
  const clientTypeRaw = get("clientType");
  const clientType = clientTypeRaw && validTypes.has(clientTypeRaw) ? clientTypeRaw : null;
  const clientTags = formData
    .getAll("clientTags")
    .map(String)
    .filter((t) => validTags.has(t));

  const before = {
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    shiftAddress: c.shiftAddress,
    city: c.city,
    shiftArrivalNotes: c.shiftArrivalNotes,
    billingEmail: c.billingEmail,
    clientType: c.clientType,
    clientTags: c.clientTags,
  };
  const after = {
    contactName,
    phone,
    email,
    shiftAddress,
    city,
    shiftArrivalNotes,
    billingEmail,
    clientType,
    clientTags,
  };

  await db
    .update(clients)
    .set({ ...after, updatedAt: new Date() })
    .where(eq(clients.id, c.id));

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "client.profile_updated",
    resource: "clients",
    resourceId: c.id,
    before,
    after,
  });

  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "client.updated",
    entityType: "client",
    entityId: c.id,
    payload: after,
    idempotencyKey: `client.updated:${c.id}:${Date.now()}`,
  });

  // Anti-takeover: if billingEmail changed AND there was a prior address,
  // notify the OLD address directly (NOT via recipientsForClient — the point
  // is to reach the address that is losing the invoices).
  const oldBilling = (before.billingEmail ?? "").toLowerCase();
  if (billingEmail && oldBilling && billingEmail !== oldBilling) {
    const send = await sendEmail({
      to: oldBilling,
      subject: `Facturatie-e-mail gewijzigd — ${c.companyName}`,
      react: (
        <BillingEmailChangedKlantEmail
          companyName={c.companyName}
          oldEmail={oldBilling}
          newEmail={billingEmail}
        />
      ),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: oldBilling,
        template: "BillingEmailChangedKlantEmail",
        eventKey: "billing_email_changed",
        entityType: "client",
        entityId: c.id,
      });
    }
  }

  redirect("/client/profile?ok=saved");
}

async function requestClientChange(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const c = await getOwnClient(session.user.id);
  if (!c) redirect("/client/profile?error=no-profile");

  const field = String(formData.get("field") ?? "") as RequestableField;
  const reason = String(formData.get("reason") ?? "").trim();
  const proposedRaw = String(formData.get("proposed") ?? "").trim();

  if (!REQUESTABLE_FIELDS.includes(field) || reason.length < 5 || !proposedRaw) {
    redirect("/client/profile?error=request-incomplete");
  }

  // Resolve current + proposed per field.
  let currentValue: unknown;
  let proposedValue: unknown;
  if (field === "paymentTermsDays") {
    const n = Number(proposedRaw);
    if (!Number.isFinite(n) || n < 0 || n > 120) {
      redirect("/client/profile?error=bad-term");
    }
    currentValue = c.paymentTermsDays;
    proposedValue = Math.round(n);
  } else if (field === "authEmail") {
    const [u] = c.userId
      ? await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, c.userId))
          .limit(1)
      : [];
    currentValue = u?.email ?? null;
    proposedValue = proposedRaw.toLowerCase();
  } else {
    currentValue = (c as Record<string, unknown>)[field] ?? null;
    proposedValue = proposedRaw;
  }

  const [req] = await db
    .insert(clientChangeRequests)
    .values({
      clientId: c.id,
      field,
      currentValue: currentValue as never,
      proposedValue: proposedValue as never,
      reason,
    })
    .returning({ id: clientChangeRequests.id });

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "client.change_requested",
    resource: "client_change_requests",
    resourceId: req.id,
    after: { field, reason },
  });

  // Notify admins via the existing klant-request route (no new event yet).
  const adminEmails = await recipientsFor("client_portal_request");
  if (adminEmails.length > 0) {
    const send = await sendEmail({
      to: adminEmails,
      subject: `Wijzigingsverzoek van ${c.companyName}: ${field}`,
      react: (
        <div>
          <h1>{`Wijzigingsverzoek van ${c.companyName}`}</h1>
          <p>
            <strong>Veld:</strong> {field}
            <br />
            <strong>Huidige waarde:</strong> {JSON.stringify(currentValue)}
            <br />
            <strong>Voorgesteld:</strong> {JSON.stringify(proposedValue)}
            <br />
            <strong>Toelichting:</strong> {reason}
          </p>
          <p>
            Open in admin:{" "}
            <a
              href={`${process.env.NEXT_PUBLIC_APP_URL}/admin/business/clients/${c.id}`}
            >
              klant-detail
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
          template: "ClientChangeRequestAdminInline",
          eventKey: "client_portal_request",
          entityType: "client_change_requests",
          entityId: req.id,
        });
      }
    }
  }

  redirect("/client/profile?ok=requested");
}

export default async function ClientProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requireAuth("/client/profile");
  const sp = await searchParams;

  const c = await getOwnClient(session.user.id);
  if (!c) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">
          Je account is wel actief, maar er is nog geen klant-profiel aan je
          gekoppeld. Stuur een berichtje naar het kantoor.
        </p>
      </div>
    );
  }

  const [authUser] = c.userId
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, c.userId))
        .limit(1)
    : [];

  const pending = await db
    .select()
    .from(clientChangeRequests)
    .where(
      and(
        eq(clientChangeRequests.clientId, c.id),
        eq(clientChangeRequests.status, "pending"),
      ),
    )
    .orderBy(desc(clientChangeRequests.createdAt));

  const flashOk =
    sp.ok === "saved"
      ? "✓ Profiel opgeslagen."
      : sp.ok === "requested"
        ? "✓ Verzoek verstuurd naar Chef & Serve."
        : null;
  const flashErr =
    sp.error === "request-incomplete"
      ? "Vul alle velden in (toelichting min 5 tekens)."
      : sp.error === "bad-term"
        ? "Betaaltermijn klopt niet — kies een getal tussen 0 en 120."
        : sp.error === "no-profile"
          ? "Geen klant-profiel gevonden."
          : null;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn klantprofiel
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {c.companyName}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-500">
        Sommige gegevens kun je direct aanpassen. Bedrijfs- en
        facturatiegegevens controleren we eerst, zodat offertes, facturen en
        afspraken blijven kloppen.
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

      {pending.length > 0 ? (
        <section className="mt-8 rounded-lg border border-burgundy/30 bg-burgundy/5 p-5">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Wijzigingen in behandeling
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-ink-900">{labelForField(p.field)}</p>
                  {p.reason ? (
                    <p className="text-xs text-ink-500">{p.reason}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                  Wacht op akkoord
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ClientProfileForm
        client={{
          contactName: c.contactName,
          phone: c.phone,
          email: c.email,
          shiftAddress: c.shiftAddress,
          city: c.city,
          shiftArrivalNotes: c.shiftArrivalNotes,
          billingEmail: c.billingEmail,
          clientType: c.clientType,
          clientTags: c.clientTags,
        }}
        saveAction={saveClientProfile}
      />

      <ClientRequestChangeFormSection
        client={{
          companyName: c.companyName,
          kvk: c.kvk,
          btw: c.btw,
          paymentTermsDays: c.paymentTermsDays,
          billingAddress: c.billingAddress,
          authEmail: authUser?.email ?? c.email,
        }}
        requestAction={requestClientChange}
      />
    </div>
  );
}

function labelForField(field: string): string {
  return (
    {
      companyName: "Bedrijfsnaam",
      kvk: "KvK-nummer",
      btw: "BTW-nummer",
      paymentTermsDays: "Betaaltermijn",
      billingAddress: "Factuuradres",
      authEmail: "Inlog-e-mailadres",
    } as Record<string, string>
  )[field] ?? field;
}
