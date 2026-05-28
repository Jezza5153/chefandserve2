/**
 * /admin/business/integrations/outbox — pending + failed outbox rows.
 *
 * PR-CHEF-0. Lets Maarten retry a failed delivery (or inspect what's queued).
 * Super_admin only.
 */

import Link from "next/link";
import { revalidatePath } from "next/cache";

import { recordAuditFromRequest } from "@/lib/audit";

import {
  invalidateHealthCache,
  listPendingOutbox,
  retryRow,
} from "@/lib/integrations";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Outbox", robots: { index: false } };
export const dynamic = "force-dynamic";

async function retry(formData: FormData) {
  "use server";
  const session = await requireRole("super_admin", undefined, { strict: true });
  const outboxId = String(formData.get("outboxId") ?? "");
  if (!outboxId) return;

  await retryRow(outboxId);
  invalidateHealthCache();

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "integration.outbox_retried",
    resource: "integration_outbox",
    resourceId: outboxId,
  })
    .catch(() => {});

  revalidatePath("/admin/business/integrations/outbox");
  revalidatePath("/admin/business/integrations");
}

export default async function OutboxPage() {
  await requireRole("super_admin", undefined, { strict: true });
  const rows = await listPendingOutbox(200);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link
          href="/admin/business/integrations"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Terug naar integraties
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Systeem · integraties
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Outbox
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Elke export naar een extern systeem (payroll, accounting, calendar)
        gaat eerst hier door. Workers pikken pending rijen op; failed rijen
        wachten op handmatige retry.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Geen wachtende of mislukte items. Alles is verwerkt.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-bg-gray text-left">
              <tr>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Provider
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Event
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Entity
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Status
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Pogingen
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Volgende
                </th>
                <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                  Actie
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.provider}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">{r.eventType}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-500">
                    {r.entityType}·{r.entityId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <OutboxStatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-700">{r.attempts}</td>
                  <td className="px-3 py-2 text-xs text-ink-500">
                    {r.nextAttemptAt
                      ? new Date(r.nextAttemptAt).toLocaleString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                    {r.lastError ? (
                      <div className="mt-1 max-w-xs truncate text-burgundy">
                        {r.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "failed" ? (
                      <form action={retry}>
                        <input type="hidden" name="outboxId" value={r.id} />
                        <button
                          type="submit"
                          className="rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
                        >
                          Probeer opnieuw
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OutboxStatusBadge({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-emerald-100 text-emerald-700"
      : status === "pending"
        ? "bg-amber-100 text-amber-800"
        : status === "processing"
          ? "bg-blue-100 text-blue-700"
          : status === "failed"
            ? "bg-burgundy/10 text-burgundy"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-ui text-[9px] font-medium uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}
