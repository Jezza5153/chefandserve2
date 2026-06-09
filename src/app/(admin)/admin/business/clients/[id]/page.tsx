import { and, desc, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditCore, recordAuditFromRequest, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefs,
  clientChangeRequests,
  clientSubmissions,
  clients,
  users,
} from "@/lib/db/schema";
import { isValidEmail } from "@/lib/forms/validation";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { buildClientTrends, getClientSummary } from "@/lib/domain/client-history";
import { computeClientHealth } from "@/lib/domain/client-health";
import { getClientIntelSnapshot } from "@/lib/domain/intel";
import { getClientDailySeries } from "@/lib/domain/metrics-history";
import {
  activatePortalUser,
  disablePortalUser,
  inviteClientToPortal,
} from "@/lib/domain/portal-invites";
import { sendEmail } from "@/lib/email";
import { enqueueIntegrationEvent, recordEmailMessage } from "@/lib/integrations";
import { requirePermission } from "@/lib/permissions";
import { DetailShell } from "@/components/ui/DetailShell";
import { BasicsForm } from "./_components/BasicsForm";
import { Binnenkort } from "./_components/Binnenkort";
import { ChangeRequestsSection } from "./_components/ChangeRequestsSection";
import { ClientTypeSection } from "./_components/ClientTypeSection";
import { ClientHealthCard } from "./_components/ClientHealthCard";
import { KlantBreinCard } from "./_components/KlantBreinCard";
import { KlantPatronenCard } from "./_components/KlantPatronenCard";
import { KlantSnapshotCard } from "./_components/KlantSnapshotCard";
import { Klant360 } from "./_components/Klant360";
import { PortalAccessSection } from "./_components/PortalAccessSection";

export const metadata = { title: "Klant" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("clients", "write");
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

  // KPI-3: Klant 360 — live point-in-time summary + 8-week snapshot trends.
  // PR-INTEL: booking patterns + chef relationships (weekday histogram, role mix, vaste chefs).
  const [clientSummary, clientSeries, snapshot] = await Promise.all([
    getClientSummary(id),
    getClientDailySeries(id, 90),
    getClientIntelSnapshot(id),
  ]);
  if (!snapshot) notFound();
  const clientTrends = buildClientTrends(clientSeries);
  // Klant 360 verdict — "goede klant?" (computed inline; summary + status already loaded).
  const clientHealth = computeClientHealth({
    status: client.status,
    completedShifts: clientSummary.completedShifts,
    upcomingShifts: clientSummary.upcomingShifts,
    marginCents: clientSummary.marginCents,
    spendCents: clientSummary.spendCents,
    repeatChefs: clientSummary.repeatChefs,
    ratingsGiven: clientSummary.ratingsGiven,
    pendingSignoff: clientSummary.pendingSignoff,
    signoffAvgHours: clientSummary.signoffAvgHours,
  });

  // PR-2B: set client_type + client_tags (the "wat voor klant" signal).
  async function updateClientType(formData: FormData) {
    "use server";
    const session = await requirePermission("clients", "write");
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
    const session = await requirePermission("clients", "write");
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
    const session = await requirePermission("clients", "write");
    const result = await inviteClientToPortal(id, session.user.id);
    if (!result.ok) throw new Error(result.error);
    redirect(`/admin/business/clients/${id}`);
  }
  async function doActivatePortal() {
    "use server";
    const session = await requirePermission("clients", "write");
    if (!client!.userId) throw new Error("Client has no portal user yet");
    await activatePortalUser(client!.userId, session.user.id);
    redirect(`/admin/business/clients/${id}`);
  }
  async function doDisablePortal() {
    "use server";
    const session = await requirePermission("clients", "write");
    if (!client!.userId) return;
    await disablePortalUser(client!.userId, session.user.id);
    redirect(`/admin/business/clients/${id}`);
  }
  // One-click: create + activate (+ welcome mail) so there's no invited-but-can't-login limbo.
  async function doInviteAndActivate() {
    "use server";
    const session = await requirePermission("clients", "write");
    const invited = await inviteClientToPortal(id, session.user.id);
    if (!invited.ok) throw new Error(invited.error);
    await activatePortalUser(invited.userId, session.user.id);
    redirect(`/admin/business/clients/${id}`);
  }

  // PR-INTEL: "Maarten's brein" — the six judgment fields the AI reasons over.
  async function saveClientIntel(formData: FormData) {
    "use server";
    await requirePermission("clients", "write");
    const f = (k: string) => String(formData.get(k) ?? "").trim() || undefined;
    const intel = {
      bestChefType: f("bestChefType"),
      caresAbout: f("caresAbout"),
      hiddenRisk: f("hiddenRisk"),
      commercialValue: f("commercialValue"),
      relationshipStatus: f("relationshipStatus"),
      nextBestAction: f("nextBestAction"),
    };
    await db.update(clients).set({ intel, updatedAt: new Date() }).where(eq(clients.id, id));
    await recordAuditFromRequest({ action: "clients.intel_updated", resource: "clients", resourceId: id });
    revalidatePath(`/admin/business/clients/${id}`);
  }

  async function updateBasics(formData: FormData) {
    "use server";
    const session = await requirePermission("clients", "write");
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
    const session = await requirePermission("clients", "write");
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

    // Validate the proposed value BEFORE applying (no raw DB throw on bad input).
    // authEmail is the klant login address — validate format + uniqueness.
    const proposedEmail =
      decision === "approved" && req.field === "authEmail"
        ? String(req.proposedValue ?? "").trim().toLowerCase()
        : null;
    if (decision === "approved" && req.field === "authEmail") {
      if (!proposedEmail || !isValidEmail(proposedEmail)) {
        redirect(`/admin/business/clients/${id}?err=ongeldig-emailadres`);
      }
      // users.email is UNIQUE — a clash would 500 inside the tx. Exclude the
      // klant's own linked user.
      const clash = await db
        .select({ id: users.id })
        .from(users)
        .where(
          client!.userId
            ? and(eq(users.email, proposedEmail), ne(users.id, client!.userId))
            : eq(users.email, proposedEmail),
        )
        .limit(1);
      if (clash.length > 0) {
        redirect(`/admin/business/clients/${id}?err=emailadres-in-gebruik`);
      }
    }

    // Atomic: apply the field change + flip the status in ONE tx (so a partial
    // apply can't outlive a failed/stale transition). Audit commits in the same
    // tx. redirect() stays OUTSIDE (it throws → would roll back).
    const auditBase = await stampFromRequest({
      userId: session.user.id,
      action: decision === "approved" ? "client.change_approved" : "client.change_rejected",
      resource: "client_change_requests",
      resourceId: requestId,
      after: { field: req.field, decision, decisionNotes },
    });
    const result = await withTx(async (tx) => {
      // Guard first: only a still-pending request flips. Zero rows → stale.
      const flipped = await tx
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
      if (flipped.length === 0) return { ok: false as const };

      // Apply the validated field change (only when approved).
      if (decision === "approved") {
        if (req.field === "authEmail") {
          // Auth email lives on users — update it (klant logs in with new email).
          if (client!.userId && proposedEmail) {
            await tx
              .update(users)
              .set({ email: proposedEmail, updatedAt: new Date() })
              .where(eq(users.id, client!.userId));
          }
        } else if (req.field === "paymentTermsDays") {
          await tx
            .update(clients)
            .set({ paymentTermsDays: Number(req.proposedValue), updatedAt: new Date() })
            .where(eq(clients.id, id));
        } else {
          const col = CLIENT_FIELD_COLUMN[req.field];
          if (col) {
            await tx
              .update(clients)
              .set({ [col]: String(req.proposedValue), updatedAt: new Date() })
              .where(eq(clients.id, id));
          }
        }
      }

      await recordAuditCore(auditBase, tx);
      return { ok: true as const };
    });
    if (!result.ok) redirect(`/admin/business/clients/${id}?err=request-gone`);

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
    <DetailShell
      className="mx-auto max-w-3xl"
      backHref="/admin/business/clients"
      backLabel="Alle klanten"
      eyebrow="Klant-profiel"
      title={client.companyName}
      actions={<StatusBadge status={client.status} />}
    >
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

      <ClientHealthCard verdict={clientHealth} />

      {/* PR-INTEL-P2: "Voor je belt" — composed brein + patronen glance */}
      <KlantSnapshotCard snapshot={snapshot} />

      {/* PR-INTEL: Patronen & relaties — booking patterns + vaste chefs */}
      <KlantPatronenCard patterns={snapshot.patterns} />

      {/* PR-INTEL: Maarten's brein — the six judgment fields (internal-only) */}
      <KlantBreinCard intel={client.intel} saveAction={saveClientIntel} />

      <BasicsForm client={client} updateBasics={updateBasics} />

      {/* PR-2B: Klanttype + tags + favoriete / geblokkeerde chefs */}
      {/* KPI-3: Klant 360 — realized performance + 8-week trends */}
      <Klant360 clientSummary={clientSummary} clientTrends={clientTrends} />

      <ClientTypeSection
        client={client}
        chefNameById={chefNameById}
        updateClientType={updateClientType}
        removeClientChef={removeClientChef}
      />

      {/* Portal access */}
      <PortalAccessSection
        client={client}
        portalUser={portalUser ?? null}
        doInviteToPortal={doInviteToPortal}
        doInviteAndActivate={doInviteAndActivate}
        doActivatePortal={doActivatePortal}
        doDisablePortal={doDisablePortal}
      />

      {/* PR-KLANT-1: Wijzigingsverzoeken */}
      <ChangeRequestsSection
        pendingChanges={pendingChanges}
        decidedChanges={decidedChanges}
        approveClientChange={approveClientChange}
        rejectClientChange={rejectClientChange}
        clientChangeFieldLabel={clientChangeFieldLabel}
      />

      <Binnenkort />
    </DetailShell>
  );
}

/* ----- helpers ----- */
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
