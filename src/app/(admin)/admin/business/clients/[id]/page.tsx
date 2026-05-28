import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefs,
  clientChangeRequests,
  clientSubmissions,
  clients,
  users,
} from "@/lib/db/schema";
import {
  CLIENT_TAG_OPTIONS,
  CLIENT_TYPE_OPTIONS,
} from "@/lib/domain/client-taxonomy";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import {
  activatePortalUser,
  disablePortalUser,
  inviteClientToPortal,
} from "@/lib/domain/portal-invites";
import { sendEmail } from "@/lib/email";
import { enqueueIntegrationEvent, recordEmailMessage } from "@/lib/integrations";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Klant" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("owner");
  const { id } = await params;

  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) notFound();

  const sourceSubmission = client.sourceSubmissionId
    ? await db.query.clientSubmissions.findFirst({
        where: eq(clientSubmissions.id, client.sourceSubmissionId),
      })
    : null;

  const portalUser = client.userId
    ? await db.query.users.findFirst({ where: eq(users.id, client.userId) })
    : null;

  // PR-KLANT-1: change requests (pending first, then recent decisions).
  const changeRequests = await db
    .select()
    .from(clientChangeRequests)
    .where(eq(clientChangeRequests.clientId, id))
    .orderBy(desc(clientChangeRequests.createdAt))
    .limit(25);
  const pendingChanges = changeRequests.filter((r) => r.status === "pending");
  const decidedChanges = changeRequests.filter((r) => r.status !== "pending");

  // PR-2B: resolve favorite/blocked chef names for display.
  const relatedChefIds = [
    ...(client.favoriteChefIds ?? []),
    ...(client.blockedChefIds ?? []),
  ];
  const relatedChefs = relatedChefIds.length
    ? await db
        .select({ id: chefs.id, fullName: chefs.fullName })
        .from(chefs)
        .where(inArray(chefs.id, relatedChefIds))
    : [];
  const chefNameById = new Map(relatedChefs.map((c) => [c.id, c.fullName]));

  // PR-2B: set client_type + client_tags (the "wat voor klant" signal).
  async function updateClientType(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const clientType = String(formData.get("clientType") ?? "").trim() || null;
    const clientTags = formData.getAll("clientTags").map(String).filter(Boolean);
    await db
      .update(clients)
      .set({
        clientType,
        clientTags: clientTags.length ? clientTags : null,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, id));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "clients.update_type",
      resource: "clients",
      resourceId: id,
      after: { clientType, clientTags },
    });
    redirect(`/admin/business/clients/${id}`);
  }

  // PR-2B: remove a chef from the favorite/blocked list (set it on a shift).
  async function removeClientChef(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const chefId = String(formData.get("chefId") ?? "");
    const kind = String(formData.get("kind") ?? "");
    if (!chefId) return;
    const current =
      (kind === "blocked" ? client!.blockedChefIds : client!.favoriteChefIds) ?? [];
    const next = current.filter((x) => x !== chefId);
    await db
      .update(clients)
      .set(kind === "blocked" ? { blockedChefIds: next } : { favoriteChefIds: next })
      .where(eq(clients.id, id));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: kind === "blocked" ? "clients.unblock_chef" : "clients.unfavorite_chef",
      resource: "clients",
      resourceId: id,
      after: { chefId },
    });
    redirect(`/admin/business/clients/${id}`);
  }

  async function doInviteToPortal() {
    "use server";
    const session = await requireRole("owner");
    const result = await inviteClientToPortal(id, session.user.id);
    if (!result.ok) throw new Error(result.error);
    redirect(`/admin/business/clients/${id}`);
  }
  async function doActivatePortal() {
    "use server";
    const session = await requireRole("owner");
    if (!client!.userId) throw new Error("Client has no portal user yet");
    await activatePortalUser(client!.userId, session.user.id);
    redirect(`/admin/business/clients/${id}`);
  }
  async function doDisablePortal() {
    "use server";
    const session = await requireRole("owner");
    if (!client!.userId) return;
    await disablePortalUser(client!.userId, session.user.id);
    redirect(`/admin/business/clients/${id}`);
  }

  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const companyName = String(formData.get("companyName") ?? "").trim();
    const contactName = String(formData.get("contactName") ?? "").trim() || null;
    const email =
      String(formData.get("email") ?? "").trim().toLowerCase() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const address = String(formData.get("address") ?? "").trim() || null;
    const city = String(formData.get("city") ?? "").trim() || null;
    const kvk = String(formData.get("kvk") ?? "").trim() || null;
    const btw = String(formData.get("btw") ?? "").trim() || null;
    const billingEmail =
      String(formData.get("billingEmail") ?? "").trim().toLowerCase() || null;
    const paymentTermsDays = formData.get("paymentTermsDays")
      ? Number(formData.get("paymentTermsDays"))
      : 14;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const status = String(formData.get("status") ?? "prospect") as
      | "prospect"
      | "active"
      | "paused"
      | "archived";

    await db
      .update(clients)
      .set({
        companyName,
        contactName,
        email,
        phone,
        address,
        city,
        kvk,
        btw,
        billingEmail,
        paymentTermsDays,
        notes,
        status,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, id));

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "clients.update",
      resource: "clients",
      resourceId: id,
    });

    redirect(`/admin/business/clients/${id}`);
  }

  // PR-KLANT-1: which clients column each requestable field maps to.
  const CLIENT_FIELD_COLUMN: Record<string, keyof typeof clients.$inferInsert> = {
    companyName: "companyName",
    kvk: "kvk",
    btw: "btw",
    paymentTermsDays: "paymentTermsDays",
    billingAddress: "billingAddress",
  };

  async function decideClientChange(formData: FormData, decision: "approved" | "rejected") {
    "use server";
    const session = await requireRole("owner");
    const requestId = String(formData.get("requestId") ?? "");
    const decisionNotes = String(formData.get("decisionNotes") ?? "").trim() || null;
    if (!requestId) return;

    const [req] = await db
      .select()
      .from(clientChangeRequests)
      .where(eq(clientChangeRequests.id, requestId))
      .limit(1);
    if (!req || req.clientId !== id || req.status !== "pending") {
      redirect(`/admin/business/clients/${id}?err=request-gone`);
    }

    // Apply the field change on approval.
    if (decision === "approved") {
      if (req.field === "authEmail") {
        // Auth email lives on users — update it (klant logs in with new email).
        if (client!.userId) {
          await db
            .update(users)
            .set({ email: String(req.proposedValue).toLowerCase(), updatedAt: new Date() })
            .where(eq(users.id, client!.userId));
        }
      } else if (req.field === "paymentTermsDays") {
        await db
          .update(clients)
          .set({ paymentTermsDays: Number(req.proposedValue), updatedAt: new Date() })
          .where(eq(clients.id, id));
      } else {
        const col = CLIENT_FIELD_COLUMN[req.field];
        if (col) {
          await db
            .update(clients)
            .set({ [col]: String(req.proposedValue), updatedAt: new Date() })
            .where(eq(clients.id, id));
        }
      }
    }

    // Atomic state transition — only flip a still-pending request.
    const updated = await db
      .update(clientChangeRequests)
      .set({
        status: decision,
        decidedAt: new Date(),
        decidedBy: session.user.id,
        decisionNotes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clientChangeRequests.id, requestId),
          eq(clientChangeRequests.status, "pending"),
        ),
      )
      .returning({ id: clientChangeRequests.id });
    if (updated.length === 0) redirect(`/admin/business/clients/${id}?err=request-gone`);

    await recordAuditFromRequest({
      userId: session.user.id,
      action: decision === "approved" ? "client.change_approved" : "client.change_rejected",
      resource: "client_change_requests",
      resourceId: requestId,
      after: { field: req.field, decision, decisionNotes },
    });

    if (decision === "approved") {
      await enqueueIntegrationEvent({
        provider: "internal",
        eventType: "client.updated",
        entityType: "client",
        entityId: id,
        payload: { field: req.field, value: req.proposedValue },
        idempotencyKey: `client.updated:${id}:change:${requestId}`,
      });
    }

    // Outcome email to the klant — routes through recipientsForClient (the
    // single klant email seam), never a hard-coded client.email.
    const to = await recipientsForClient(id, "generic");
    if (to.length > 0) {
      const fieldLabel = clientChangeFieldLabel(req.field);
      const send = await sendEmail({
        to,
        subject:
          decision === "approved"
            ? `Wijziging doorgevoerd: ${fieldLabel}`
            : `Wijzigingsverzoek niet doorgevoerd: ${fieldLabel}`,
        react: (
          <div>
            <h1>
              {decision === "approved"
                ? "Je wijziging is doorgevoerd"
                : "Je wijzigingsverzoek is niet doorgevoerd"}
            </h1>
            <p>
              <strong>Onderdeel:</strong> {fieldLabel}
              <br />
              {decision === "approved" ? (
                <>
                  <strong>Nieuwe waarde:</strong> {String(req.proposedValue)}
                </>
              ) : null}
              {decisionNotes ? (
                <>
                  <br />
                  <strong>Toelichting van Chef &amp; Serve:</strong> {decisionNotes}
                </>
              ) : null}
            </p>
            <p>Vragen? Mail of bel het kantoor — we helpen je graag.</p>
          </div>
        ),
      });
      if (send.ok) {
        for (const addr of to) {
          await recordEmailMessage({
            providerMessageId: send.id,
            toEmail: addr,
            template: "ClientChangeOutcomeInline",
            eventKey: "generic",
            entityType: "client_change_requests",
            entityId: requestId,
          });
        }
      }
    }

    redirect(`/admin/business/clients/${id}?ok=change-${decision}`);
  }

  async function approveClientChange(formData: FormData) {
    "use server";
    await decideClientChange(formData, "approved");
  }
  async function rejectClientChange(formData: FormData) {
    "use server";
    await decideClientChange(formData, "rejected");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/business/clients"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Alle klanten
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Klant-profiel
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {client.companyName}
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Toegevoegd{" "}
            {new Date(client.joinedAt).toLocaleDateString("nl-NL", {
              dateStyle: "long",
            })}
            {sourceSubmission && (
              <>
                {" · "}
                <Link
                  href={`/admin/business/inbox/client/${sourceSubmission.id}`}
                  className="text-burgundy underline-offset-4 hover:underline"
                >
                  via inbox
                </Link>
              </>
            )}
          </p>
        </div>
        <StatusBadge status={client.status} />
      </div>

      <form
        action={updateBasics}
        className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2"
      >
        <Field label="Bedrijfsnaam" name="companyName" defaultValue={client.companyName} required />
        <Field
          label="Status"
          name="status"
          as="select"
          defaultValue={client.status}
          options={[
            { value: "prospect", label: "Prospect" },
            { value: "active", label: "Actief" },
            { value: "paused", label: "Gepauzeerd" },
            { value: "archived", label: "Gearchiveerd" },
          ]}
        />
        <Field label="Contactpersoon" name="contactName" defaultValue={client.contactName ?? ""} />
        <Field label="E-mail" name="email" type="email" defaultValue={client.email ?? ""} />
        <Field label="Telefoon" name="phone" defaultValue={client.phone ?? ""} />
        <Field label="Stad" name="city" defaultValue={client.city ?? ""} />
        <div className="md:col-span-2">
          <Field label="Adres" name="address" defaultValue={client.address ?? ""} />
        </div>
        <Field label="KvK-nummer" name="kvk" defaultValue={client.kvk ?? ""} />
        <Field label="Btw / VAT" name="btw" defaultValue={client.btw ?? ""} />
        <Field
          label="Factuur-e-mail"
          name="billingEmail"
          type="email"
          defaultValue={client.billingEmail ?? ""}
        />
        <Field
          label="Betalingstermijn (dagen)"
          name="paymentTermsDays"
          type="number"
          defaultValue={(client.paymentTermsDays ?? 14).toString()}
        />
        <div className="md:col-span-2">
          <Field
            label="Notities (Maarten's tribal knowledge)"
            name="notes"
            as="textarea"
            defaultValue={client.notes ?? ""}
          />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Opslaan
          </button>
        </div>
      </form>

      {/* PR-2B: Klanttype + tags + favoriete / geblokkeerde chefs */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Klanttype &amp; voorkeuren</h2>
        <p className="mt-1 text-sm text-ink-700">
          Bepaalt &quot;wat voor klant&quot; — voedt Chef 360 (&quot;welk klanttype
          doet deze chef&quot;), de filters en de matching-redenen.
        </p>
        <form action={updateClientType} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
              Klanttype
            </span>
            <select
              name="clientType"
              defaultValue={client.clientType ?? ""}
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="">— kies —</option>
              {CLIENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="md:col-span-2">
            <legend className="mb-1.5 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
              Tags
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CLIENT_TAG_OPTIONS.map((t) => (
                <label key={t.value} className="flex items-center gap-1.5 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    name="clientTags"
                    value={t.value}
                    defaultChecked={(client.clientTags ?? []).includes(t.value)}
                    className="accent-burgundy"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Opslaan
            </button>
          </div>
        </form>

        <div className="mt-6 grid gap-6 border-t border-ink-100 pt-6 md:grid-cols-2">
          <ClientChefList
            tone="favorite"
            heading="★ Favoriete chefs"
            chefIds={client.favoriteChefIds ?? []}
            chefNameById={chefNameById}
            action={removeClientChef}
            emptyHint="Nog geen favorieten. Markeer een chef vanaf een shift."
          />
          <ClientChefList
            tone="blocked"
            heading="⊘ Geblokkeerde chefs"
            chefIds={client.blockedChefIds ?? []}
            chefNameById={chefNameById}
            action={removeClientChef}
            emptyHint="Geen geblokkeerde chefs. Blokkeer een chef vanaf een shift."
          />
        </div>
      </section>

      {/* Portal access */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-ink-900">
              Klant-portaal toegang
            </h2>
            <p className="mt-1 text-sm text-ink-700">
              Geef deze klant toegang om zelf hun bookings te zien en aanvragen
              in te dienen.
            </p>
          </div>
          {!client.email ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Vul eerst een e-mailadres in.
            </p>
          ) : !portalUser ? (
            <form action={doInviteToPortal}>
              <button
                type="submit"
                className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
              >
                Nodig uit voor portaal
              </button>
            </form>
          ) : portalUser.status === "invited" ? (
            <form action={doActivatePortal}>
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
              >
                Activeer (stuur welkom-mail)
              </button>
            </form>
          ) : portalUser.status === "active" ? (
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-emerald-700">
                Actief
              </span>
              <form action={doDisablePortal}>
                <button
                  type="submit"
                  className="rounded-full border border-red-300 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                >
                  Toegang intrekken
                </button>
              </form>
            </div>
          ) : (
            <span className="rounded-full bg-bg-gray px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-ink-500">
              {portalUser.status}
            </span>
          )}
        </div>
        {portalUser && (
          <p className="mt-4 text-xs text-ink-500">
            Portal user: {portalUser.email} · status: {portalUser.status}
          </p>
        )}
      </section>

      {/* PR-KLANT-1: Wijzigingsverzoeken */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Wijzigingsverzoeken</h2>
        <p className="mt-1 text-sm text-ink-700">
          Bedrijfs- en facturatiegegevens die de klant via het portaal heeft
          aangevraagd. Goedkeuren voert de wijziging direct door.
        </p>

        {pendingChanges.length === 0 ? (
          <p className="mt-4 rounded bg-bg-gray px-3 py-2 text-xs text-ink-500">
            Geen openstaande verzoeken.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pendingChanges.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-amber-300 bg-amber-50/50 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                    {clientChangeFieldLabel(r.field)}
                  </p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                    Wacht op akkoord
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-sm text-ink-900">
                  <p>
                    <span className="text-ink-500">Huidig:</span>{" "}
                    {formatChangeValue(r.currentValue)}
                  </p>
                  <p>
                    <span className="text-ink-500">Voorgesteld:</span>{" "}
                    <strong>{formatChangeValue(r.proposedValue)}</strong>
                  </p>
                  {r.reason ? (
                    <p className="text-xs text-ink-500">
                      Toelichting klant: {r.reason}
                    </p>
                  ) : null}
                </div>

                <form action={approveClientChange} className="mt-3">
                  <input type="hidden" name="requestId" value={r.id} />
                  <textarea
                    name="decisionNotes"
                    rows={2}
                    placeholder="Optionele toelichting (gedeeld met de klant)"
                    className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="submit"
                      className="rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
                    >
                      Goedkeuren
                    </button>
                    <button
                      type="submit"
                      formAction={rejectClientChange}
                      className="rounded-full border border-red-300 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-red-700 hover:bg-red-50"
                    >
                      Afwijzen
                    </button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}

        {decidedChanges.length > 0 ? (
          <details className="mt-5">
            <summary className="cursor-pointer font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500 hover:text-burgundy">
              Geschiedenis ({decidedChanges.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {decidedChanges.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-3 border-b border-ink-200 pb-2"
                >
                  <span className="text-ink-900">
                    {clientChangeFieldLabel(r.field)} →{" "}
                    {formatChangeValue(r.proposedValue)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider ${
                      r.status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-bg-gray text-ink-500"
                    }`}
                  >
                    {r.status === "approved" ? "Doorgevoerd" : "Afgewezen"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Binnenkort op deze pagina</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>· Plaatsings-geschiedenis (Phase 3)</li>
          <li>· Aankomende shifts (Phase 3)</li>
          <li>· Facturen + betalingsstatus (Phase 5)</li>
          <li>· Gegeven ratings</li>
        </ul>
      </div>
    </div>
  );
}

/* ----- helpers ----- */
function ClientChefList({
  tone,
  heading,
  chefIds,
  chefNameById,
  action,
  emptyHint,
}: {
  tone: "favorite" | "blocked";
  heading: string;
  chefIds: string[];
  chefNameById: Map<string, string>;
  action: (formData: FormData) => Promise<void>;
  emptyHint: string;
}) {
  const headTone = tone === "favorite" ? "text-emerald-700" : "text-red-700";
  return (
    <div>
      <p className={`font-ui text-[10px] uppercase tracking-[0.2em] ${headTone}`}>
        {heading}
      </p>
      {chefIds.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500">{emptyHint}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {chefIds.map((cid) => (
            <li key={cid} className="flex items-center justify-between gap-2 text-sm">
              <Link
                href={`/admin/business/chefs/${cid}`}
                className="text-ink-900 hover:text-burgundy hover:underline"
              >
                {chefNameById.get(cid) ?? cid}
              </Link>
              <form action={action}>
                <input type="hidden" name="chefId" value={cid} />
                <input type="hidden" name="kind" value={tone} />
                <button
                  type="submit"
                  className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:text-red-600"
                >
                  verwijderen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  as?: "input" | "textarea" | "select";
  options?: { value: string; label: string }[];
};

function Field({
  label,
  name,
  type = "text",
  defaultValue = "",
  required,
  as = "input",
  options,
}: FieldProps) {
  const baseClass =
    "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
  return (
    <label className="block">
      <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </span>
      {as === "textarea" ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          required={required}
          rows={4}
          className={baseClass}
        />
      ) : as === "select" ? (
        <select name={name} defaultValue={defaultValue} className={baseClass}>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          required={required}
          className={baseClass}
        />
      )}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "prospect"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    prospect: "Prospect",
    active: "Actief",
    paused: "Gepauzeerd",
    archived: "Gearchiveerd",
  };
  return (
    <span
      className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function clientChangeFieldLabel(field: string): string {
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

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
