import { desc } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { webhooksReceived } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Webhooks" };

export default async function WebhooksListPage() {
  await requireRole("super_admin");

  const rows = await db
    .select()
    .from(webhooksReceived)
    .orderBy(desc(webhooksReceived.createdAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Webhooks
      </h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Alle binnenkomende webhooks (Jotform, Payingit straks). Klik door
        om de raw payload te zien of opnieuw te verwerken.
      </p>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">Nog geen webhooks</p>
          <p className="mt-2 text-sm text-ink-500">
            POST naar <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">/api/intake/chef</code> of <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">/api/intake/client</code> om de pipeline te testen.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-ink-200 bg-white">
          <table className="w-full">
            <thead className="bg-bg-gray text-left">
              <tr>
                <Th>Ontvangen</Th>
                <Th>Source</Th>
                <Th>Kind</Th>
                <Th>Verwerkt</Th>
                <Th>Signature</Th>
                <Th>Actie</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const payloadObj = (r.payload ?? {}) as Record<string, unknown>;
                const kind =
                  typeof payloadObj.kind === "string" ? payloadObj.kind : "—";
                return (
                  <tr
                    key={r.id}
                    className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                  >
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {new Date(r.createdAt).toLocaleString("nl-NL")}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {r.source}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">{kind}</td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {r.processedAt
                        ? new Date(r.processedAt).toLocaleTimeString("nl-NL")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.signatureValid === null ? (
                        <span className="text-ink-500">n/a</span>
                      ) : r.signatureValid ? (
                        <span className="text-emerald-700">✓</span>
                      ) : (
                        <span className="text-red-700">✗</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/system/webhooks/${r.id}`}
                        className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline"
                      >
                        Bekijk →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
      {children}
    </th>
  );
}
