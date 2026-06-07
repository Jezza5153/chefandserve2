import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefSubmissions,
  clientSubmissions,
} from "@/lib/db/schema";
import {
  convertChefSubmission,
  convertClientSubmission,
} from "@/lib/domain/conversions";
import { isErasedResubmission } from "@/lib/domain/privacy-subject";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Aanmelding" };

type Params = { kind: "chef" | "client"; id: string };

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  await requirePermission("inbox", "triage");
  const { kind, id } = await params;

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
