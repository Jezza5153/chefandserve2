/**
 * /admin/business/hours — admin hours queue (PR-CHEF-1 thin version).
 *
 * PR-CHEF-3 upgrades this with bulk-approve, anomaly flagging, magic button.
 * For now: simple filter + list grouped by status.
 *
 * Owner or super_admin only.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";

import { HumanStatusBadge } from "@/components/hours/HumanStatusBadge";
import { db } from "@/lib/db/client";
import { chefs, clients, shiftHours, shifts } from "@/lib/db/schema";
import {
  computeChefAmountCents,
  formatEuro,
  formatWorkedMinutes,
} from "@/lib/hours-labels";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Uren keuren", robots: { index: false } };
export const dynamic = "force-dynamic";

const FILTER_OPTIONS: Array<{ key: string; label: string; statuses: Array<typeof shiftHours.$inferSelect.status> }> = [
  { key: "wacht_op_mij", label: "Wacht op mij", statuses: ["client_signed"] },
  { key: "wacht_op_klant", label: "Wacht op klant", statuses: ["submitted"] },
  { key: "wacht_op_chef", label: "Wacht op chef", statuses: ["draft", "client_rejected", "admin_rejected"] },
  { key: "afgerond", label: "Afgerond", statuses: ["admin_approved", "exported"] },
];

export default async function AdminHoursQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; ok?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;
  const filterKey = sp.filter ?? "wacht_op_mij";
  const active = FILTER_OPTIONS.find((f) => f.key === filterKey) ?? FILTER_OPTIONS[0];

  const rows = await db
    .select({
      h: shiftHours,
      chefName: chefs.fullName,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
      shiftRole: shifts.roleNeeded,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(inArray(shiftHours.status, active.statuses))
    .orderBy(filterKey === "afgerond" ? desc(shifts.startsAt) : asc(shifts.startsAt))
    .limit(200);

  const flashOk =
    sp.ok === "approved"
      ? "✓ Uren goedgekeurd."
      : sp.ok === "rejected"
        ? "Teruggezet naar chef."
        : null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Uren keuren
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Uren die wachten op jouw goedkeuring. Klik door voor details + actie.
      </p>

      {flashOk ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashOk}
        </p>
      ) : null}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/business/hours?filter=${f.key}`}
            className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] transition-colors ${
              filterKey === f.key
                ? "bg-burgundy text-white"
                : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          {filterKey === "wacht_op_mij"
            ? "Geen uren om te keuren — alles bijgewerkt."
            : filterKey === "wacht_op_klant"
              ? "Geen uren wachten op een klant."
              : filterKey === "wacht_op_chef"
                ? "Alle chefs zijn bij."
                : "Geen afgeronde uren."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full min-w-[760px]">
            <thead className="bg-bg-gray text-left">
              <tr>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Chef
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Klant
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Datum
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Uren
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Bedrag chef
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Status
                </th>
                <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                  Actie
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, chefName, clientName, shiftStart }, i) => (
                <tr
                  key={h.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-4 py-3 text-sm text-ink-900">{chefName}</td>
                  <td className="px-4 py-3 text-sm text-ink-700">{clientName}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {new Date(shiftStart).toLocaleDateString("nl-NL", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatWorkedMinutes(h.workedMinutes)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatEuro(
                      computeChefAmountCents(h.workedMinutes, h.chefRateCents),
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <HumanStatusBadge status={h.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/business/hours/${h.id}`}
                      className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-xs text-ink-500">
        Bulk-goedkeuring + anomalie-detectie komt in PR-CHEF-3.
      </p>
    </div>
  );
}
