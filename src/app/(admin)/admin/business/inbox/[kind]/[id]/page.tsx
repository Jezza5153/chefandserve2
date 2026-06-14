import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefSubmissions,
  clients,
  clientSubmissions,
  shifts,
} from "@/lib/db/schema";
import {
  convertChefSubmission,
  convertClientSubmission,
} from "@/lib/domain/conversions";
import { createNotification } from "@/lib/integrations";
import { isErasedResubmission } from "@/lib/domain/privacy-subject";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Aanmelding" };

type Params = { kind: "chef" | "client"; id: string };

export default async function InboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requirePermission("inbox", "triage");
  const { kind, id } = await params;
  const sp = await searchParams;
  const flash =
    sp.ok === "fulfilled"
      ? { tone: "ok" as const, msg: "✓ Aanvraag gemarkeerd als opgepakt — de klant is op de hoogte." }
      : sp.err === "bad-shift"
        ? { tone: "err" as const, msg: "Die dienst bestaat niet of hoort niet bij deze klant." }
        : sp.err === "stale"
          ? { tone: "err" as const, msg: "Deze aanvraag is al verwerkt." }
          : null;

  if (kind !== "chef" && kind !== "client") notFound();

  const row =
    kind === "chef"
      ? await db.query.chefSubmissions.findFirst({
          where: eq(chefSubmissions.id, id),
        })
      : await db.query.clientSubmissions.findFirst({
          where: eq(clientSubmissions.id, id),
        });

  if (!row) notFound();

  /* ----- structured fields shown in the detail page ----- */
  const fields: Array<{ label: string; value: string | null | undefined }> =
    kind === "chef"
      ? [
          { label: "Naam", value: (row as typeof chefSubmissions.$inferSelect).fullName },
          { label: "E-mail", value: row.email },
          { label: "Telefoon", value: row.phone },
          {
            label: "Rol(len)",
            value: (row as typeof chefSubmissions.$inferSelect).rolesRequested,
          },
          {
            label: "Jaren ervaring",
            value:
              (row as typeof chefSubmissions.$inferSelect).yearsExperience !== null
                ? String(
                    (row as typeof chefSubmissions.$inferSelect).yearsExperience,
                  )
                : null,
          },
          {
            label: "Locatie-voorkeur",
            value:
              (row as typeof chefSubmissions.$inferSelect).locationPreference,
          },
          { label: "Notities", value: row.notes },
        ]
      : [
          {
            label: "Bedrijf",
            value: (row as typeof clientSubmissions.$inferSelect).companyName,
          },
          {
            label: "Contactpersoon",
            value: (row as typeof clientSubmissions.$inferSelect).contactName,
          },
          { label: "E-mail", value: row.email },
          { label: "Telefoon", value: row.phone },
          {
            label: "Rol gevraagd",
            value: (row as typeof clientSubmissions.$inferSelect).roleRequested,
          },
          {
            label: "Segment",
            value: (row as typeof clientSubmissions.$inferSelect).segment,
          },
          {
            label: "Datum nodig",
            value: (row as typeof clientSubmissions.$inferSelect).dateNeeded,
          },
          {
            label: "Aantal personen",
            value:
              (row as typeof clientSubmissions.$inferSelect).headcount !== null
                ? String(
                    (row as typeof clientSubmissions.$inferSelect).headcount,
                  )
                : null,
          },
          {
            label: "Locatie",
            value: (row as typeof clientSubmissions.$inferSelect).location,
          },
          { label: "Notities", value: row.notes },
        ];

  /* ----- server actions ----------------------------------- */
  async function markTriaged() {
    "use server";
    const session = await requirePermission("inbox", "triage");
    const table = kind === "chef" ? chefSubmissions : clientSubmissions;
    await db
      .update(table)
      .set({ status: "triaged", triagedAt: new Date(), triagedBy: session.user.id, updatedAt: new Date() })
      .where(eq(table.id, id));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "intake.triaged",
      resource: `${kind}_submission`,
      resourceId: id,
    });
    redirect(`/admin/business/inbox/${kind}/${id}`);
  }

  async function markRejected(formData: FormData) {
    "use server";
    const session = await requirePermission("inbox", "triage");
    const reason = (formData.get("reason") as string | null)?.trim() || null;
    const table = kind === "chef" ? chefSubmissions : clientSubmissions;
    await db
      .update(table)
      .set({
        status: "rejected",
        rejectedReason: reason,
        triagedAt: new Date(),
        triagedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(table.id, id));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "intake.rejected",
      resource: `${kind}_submission`,
      resourceId: id,
      after: { reason },
    });
    redirect("/admin/business/inbox");
  }

  async function markConverted() {
    "use server";
    const session = await requirePermission("inbox", "triage");
    if (kind === "chef") {
      const { chefId } = await convertChefSubmission(id, session.user.id);
      redirect(`/admin/business/chefs/${chefId}`);
    } else {
      const { clientId } = await convertClientSubmission(id, session.user.id);
      redirect(`/admin/business/clients/${clientId}`);
    }
  }

  // K3: a portal request from an EXISTING klant doesn't need a new client record —
  // the office just makes a shift for it. Mark the submission opgepakt (+ optionally
  // link the shift) so the klant's "Mijn aanvragen" resolves instead of sitting at
  // 'triaged' forever. Atomic status advance; reject 0 rows (stale).
  async function markFulfilledByShift(formData: FormData) {
    "use server";
    const session = await requirePermission("inbox", "triage");
    const shiftIdRaw = String(formData.get("shiftId") ?? "").trim();

    const [sub] = await db
      .select({ clientId: clientSubmissions.clientId })
      .from(clientSubmissions)
      .where(eq(clientSubmissions.id, id))
      .limit(1);
    if (!sub) redirect(`/admin/business/inbox/client/${id}?err=gone`);

    // If a shift id is supplied, it must exist and belong to this klant.
    let linkedShiftId: string | null = null;
    if (shiftIdRaw) {
      const [s] = await db
        .select({ id: shifts.id, clientId: shifts.clientId })
        .from(shifts)
        .where(eq(shifts.id, shiftIdRaw))
        .limit(1);
      if (!s || (sub!.clientId && s.clientId !== sub!.clientId)) {
        redirect(`/admin/business/inbox/client/${id}?err=bad-shift`);
      }
      linkedShiftId = s.id;
    }

    const flipped = await db
      .update(clientSubmissions)
      .set({
        status: "converted",
        convertedToShiftId: linkedShiftId,
        triagedAt: new Date(),
        triagedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clientSubmissions.id, id),
          inArray(clientSubmissions.status, ["new", "triaged"]),
        ),
      )
      .returning({ id: clientSubmissions.id });
    if (flipped.length === 0) redirect(`/admin/business/inbox/client/${id}?err=stale`);

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "intake.fulfilled_by_shift",
      resource: "client_submission",
      resourceId: id,
      after: { shiftId: linkedShiftId },
    });

    // Tell the klant their request is picked up (best-effort — never blocks the flip).
    if (sub!.clientId) {
      const [c] = await db
        .select({ userId: clients.userId })
        .from(clients)
        .where(eq(clients.id, sub!.clientId))
        .limit(1);
      if (c?.userId) {
        await createNotification({
          userId: c.userId,
          type: "request_fulfilled",
          title: "Je aanvraag is opgepakt",
          body: linkedShiftId
            ? "We hebben je personeelsaanvraag omgezet naar een dienst. Bekijk 'm in je overzicht."
            : "We hebben je personeelsaanvraag opgepakt en nemen contact op.",
          actionUrl: linkedShiftId ? `/client/shifts/${linkedShiftId}` : "/client/requests",
          entityType: "client_submission",
          entityId: id,
        });
      }
    }

    redirect(`/admin/business/inbox/client/${id}?ok=fulfilled`);
  }

  /* ----- view -------------------------------------------------------- */
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/business/inbox"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Terug naar inbox
        </Link>
      </div>

      {flash ? (
        <p
          className={`mb-6 rounded border px-4 py-2 text-sm ${
            flash.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-burgundy/30 bg-burgundy/5 text-burgundy"
          }`}
        >
          {flash.msg}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            {kind === "chef" ? "Chef-aanmelding" : "Klant-aanvraag"}
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {kind === "chef"
              ? (row as typeof chefSubmissions.$inferSelect).fullName ?? "(naamloos)"
              : (row as typeof clientSubmissions.$inferSelect).companyName ??
                (row as typeof clientSubmissions.$inferSelect).contactName ??
                "(naamloos)"}
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Ontvangen{" "}
            {new Date(row.createdAt).toLocaleString("nl-NL", {
              dateStyle: "short",
              timeStyle: "short",
            })}{" "}
            · via {row.source}
            {row.triagedAt &&
              ` · in behandeling sinds ${new Date(row.triagedAt).toLocaleString("nl-NL")}`}
          </p>
        </div>
        <StatusBadge status={row.status} />
      </div>

      {/* AVG: quarantined re-import from an erased subject — needs human review */}
      {isErasedResubmission(row.rejectedReason) && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50/70 p-5">
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-red-700">
            Review vereist — gewiste persoon heeft opnieuw ingediend
          </p>
          <p className="mt-2 text-sm text-ink-700">
            Dit e-mailadres is eerder gewist op verzoek (AVG art. 17). Deze
            aanmelding is <strong>niet</strong> automatisch verwerkt. Beoordeel
            handmatig of dit een nieuwe, rechtmatige relatie is — leg pas
            gegevens vast (converteren) met een geldige grondslag en verse
            toestemming; wijs anders af.
          </p>
        </div>
      )}

      {/* Structured fields */}
      <dl className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
              {f.label}
            </dt>
            <dd className="mt-1 text-sm text-ink-900">
              {f.value || <span className="text-ink-500">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Actions */}
      {row.status !== "converted" && row.status !== "rejected" && (
        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {row.status === "new" && (
            <form action={markTriaged}>
              <button
                type="submit"
                className="w-full rounded-full border border-ink-200 bg-white px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:border-burgundy hover:text-burgundy"
              >
                Markeer in behandeling
              </button>
            </form>
          )}

          <form action={markConverted}>
            <button
              type="submit"
              className="w-full rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
              title="Phase 2 voegt de echte chef/client-record toe — voor nu wordt alleen de status geupdated"
            >
              Converteer naar {kind === "chef" ? "chef" : "klant"}
            </button>
          </form>

          <form action={markRejected}>
            <div className="flex gap-2">
              <input
                type="text"
                name="reason"
                placeholder="Reden (optioneel)"
                className="flex-1 rounded border border-ink-200 bg-white px-3 py-2 text-sm placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
              <button
                type="submit"
                className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 transition-colors hover:border-red-300 hover:text-red-700"
              >
                Afwijzen
              </button>
            </div>
          </form>
        </section>
      )}

      {/* K3: resolve a portal request without minting a new client — the klant
          already exists; the office just made (or will make) a shift for it.
          Advances the submission to 'converted' + optionally links the shift so
          the klant's "Mijn aanvragen" shows "Omgezet naar dienst". */}
      {kind === "client" && row.status !== "converted" && row.status !== "rejected" && (
        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-5">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Aanvraag opgepakt?
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Markeer deze aanvraag als opgepakt — voor een bestaande klant die alleen een
            dienst nodig heeft (geen nieuw klant-record). Plak optioneel de dienst-ID zodat
            de klant in zijn portaal &ldquo;Omgezet naar dienst&rdquo; ziet.
          </p>
          <form action={markFulfilledByShift} className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              name="shiftId"
              placeholder="Dienst-ID (optioneel)"
              className="flex-1 rounded border border-ink-200 bg-white px-3 py-2 text-sm placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
            >
              Markeer opgepakt
            </button>
          </form>
        </section>
      )}

      {/* Raw payload (collapsible) */}
      <details className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
          Ruwe Jotform payload
        </summary>
        <pre className="mt-4 max-h-96 overflow-auto rounded bg-bg-gray p-4 text-[11px] leading-relaxed text-ink-700">
          {JSON.stringify(row.rawPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "new"
      ? "bg-amber-100 text-amber-700"
      : status === "triaged"
        ? "bg-blue-100 text-blue-700"
        : status === "converted"
          ? "bg-emerald-100 text-emerald-700"
          : status === "rejected"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  const LABELS: Record<string, string> = {
    new: "Nieuw",
    triaged: "In behandeling",
    converted: "Geconverteerd",
    rejected: "Afgewezen",
    duplicate: "Dubbel",
  };
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}
