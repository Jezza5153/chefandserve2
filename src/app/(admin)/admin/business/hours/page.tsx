/**
 * /admin/business/hours — admin bulk-approval queue (PR-CHEF-3).
 *
 * Eligible rows (client_signed + within ±30min + no notes + rates set)
 * show a per-row [Goedkeuren] button + a checkbox for bulk-select.
 * Ineligible rows route to the detail page for manual review.
 *
 * Magic button: [Goedkeur alle zonder afwijkingen] approves every
 * eligible row in the current filter scope. Each approval is a separate
 * atomic transaction (NOT one giant tx — preserves idempotency).
 *
 * Owner or super_admin only.
 */

import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect as redirectTo } from "next/navigation";

import { ApproveOneButton } from "./ApproveOneButton";
import { BulkApproveBar } from "./BulkApproveBar";
import { HumanStatusBadge } from "@/components/hours/HumanStatusBadge";
import { db } from "@/lib/db/client";
import { chefs, clients, shiftHours, shifts } from "@/lib/db/schema";
import { approveHoursRow, isMagicApproveEligible } from "@/lib/domain/hours";
import {
  computeChefAmountCents,
  formatEuro,
  formatWorkedMinutes,
} from "@/lib/hours-labels";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Uren keuren", robots: { index: false } };
export const dynamic = "force-dynamic";

const FILTER_OPTIONS: Array<{
  key: string;
  label: string;
  statuses: Array<typeof shiftHours.$inferSelect.status>;
}> = [
  { key: "wacht_op_mij", label: "Wacht op mij", statuses: ["client_signed"] },
  { key: "wacht_op_klant", label: "Wacht op klant", statuses: ["submitted"] },
  { key: "wacht_op_chef", label: "Wacht op chef", statuses: ["draft", "client_rejected", "admin_rejected"] },
  { key: "afgerond", label: "Afgerond", statuses: ["admin_approved", "exported"] },
];

/* -------- server action: bulk approve ------------------------------- */

async function bulkApprove(formData: FormData) {
  "use server";
  const session = await requireRole("owner");

  // Collected from checkbox inputs
  const ids = formData.getAll("hoursId").map((v) => String(v));
  if (ids.length === 0) {
    redirectTo("/admin/business/hours?error=no-selection");
  }

  let approvedCount = 0;
  let staleCount = 0;
  for (const id of ids) {
    const result = await approveHoursRow({
      hoursId: id,
      approverUserId: session.user.id,
    });
    if (result.ok) approvedCount++;
    else if (result.reason === "stale") staleCount++;
  }

  revalidatePath("/admin/business/hours");
  redirectTo(
    `/admin/business/hours?ok=approved&n=${approvedCount}${staleCount > 0 ? `&stale=${staleCount}` : ""}`,
  );
}

/* -------- server action: approve one (inline) ------------------------ */

async function approveOne(formData: FormData) {
  "use server";
  const session = await requireRole("owner");
  const id = String(formData.get("hoursId") ?? "");
  if (!id) return;

  const result = await approveHoursRow({
    hoursId: id,
    approverUserId: session.user.id,
  });
  revalidatePath("/admin/business/hours");
  if (!result.ok) {
    redirectTo("/admin/business/hours?error=stale");
  }
  redirectTo("/admin/business/hours?ok=approved&n=1");
}

/* -------- page ------------------------------------------------------- */

export default async function AdminHoursQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; ok?: string; n?: string; stale?: string; error?: string }>;
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
      shiftEnd: shifts.endsAt,
      shiftRole: shifts.roleNeeded,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(inArray(shiftHours.status, active.statuses))
    .orderBy(filterKey === "afgerond" ? desc(shifts.startsAt) : asc(shifts.startsAt))
    .limit(200);

  // Compute eligibility per row (only for client_signed filter)
  const enriched = rows.map((r) => ({
    ...r,
    eligible:
      filterKey === "wacht_op_mij" &&
      isMagicApproveEligible({
        status: r.h.status,
        startedAt: r.h.startedAt,
        endedAt: r.h.endedAt,
        breakMinutes: r.h.breakMinutes,
        chefRateCents: r.h.chefRateCents,
        clientRateCents: r.h.clientRateCents,
        chefNotes: r.h.chefNotes,
        clientNotes: r.h.clientNotes,
        shiftStart: r.shiftStart,
        shiftEnd: r.shiftEnd,
      }),
    anomalyNote: explainAnomaly(r),
  }));

  const eligibleCount = enriched.filter((e) => e.eligible).length;

  const flashOk =
    sp.ok === "approved"
      ? `✓ ${sp.n ?? "1"} ${sp.n === "1" ? "uurbriefje" : "uurbriefjes"} goedgekeurd${sp.stale ? ` · ${sp.stale} overgeslagen (stale)` : ""}.`
      : null;
  const flashErr =
    sp.error === "no-selection"
      ? "Selecteer minstens één uurbriefje om bulk goed te keuren."
      : sp.error === "stale"
        ? "De uren zijn in de tussentijd veranderd — vernieuw."
        : null;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Uren keuren
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Uren met groen vinkje voldoen aan alle veilige criteria
        (gewerkt ± 30 min van gepland, geen opmerkingen, tarieven gezet) en
        kun je veilig in bulk goedkeuren. Twijfels? Open de detailpagina.
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
        <form action={bulkApprove} className="mt-6">
          <BulkApproveBar
            eligibleCount={eligibleCount}
            visible={filterKey === "wacht_op_mij" && eligibleCount > 0}
          />

          <div className="mt-3 overflow-x-auto rounded-lg border border-ink-200 bg-white">
            <table className="w-full min-w-[900px]">
              <thead className="bg-bg-gray text-left">
                <tr>
                  <th className="px-3 py-3 w-8" />
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Chef
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Klant
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Datum
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Uren
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Bedrag chef
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Marge
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Status
                  </th>
                  <th className="px-3 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
                    Actie
                  </th>
                </tr>
              </thead>
              <tbody>
                {enriched.map(({ h, chefName, clientName, shiftStart, eligible, anomalyNote }, i) => {
                  const chefAmount = computeChefAmountCents(h.workedMinutes, h.chefRateCents);
                  const clientAmount = computeChefAmountCents(h.workedMinutes, h.clientRateCents);
                  const margin = clientAmount - chefAmount;
                  return (
                    <tr
                      key={h.id}
                      className={i < enriched.length - 1 ? "border-b border-ink-200" : ""}
                    >
                      <td className="px-3 py-2 align-top">
                        {eligible ? (
                          <input
                            type="checkbox"
                            name="hoursId"
                            value={h.id}
                            className="h-4 w-4 accent-emerald-600"
                            aria-label="Selecteer voor bulk goedkeuren"
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-sm text-ink-900">{chefName}</td>
                      <td className="px-3 py-2 text-sm text-ink-700">{clientName}</td>
                      <td className="px-3 py-2 text-xs text-ink-500">
                        {new Date(shiftStart).toLocaleDateString("nl-NL", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {formatWorkedMinutes(h.workedMinutes)}
                        {anomalyNote ? (
                          <div className="mt-1 text-[11px] text-burgundy">⚠ {anomalyNote}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatEuro(chefAmount)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatEuro(margin)}</td>
                      <td className="px-3 py-2">
                        <HumanStatusBadge status={h.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {eligible ? (
                          <ApproveOneButton hoursId={h.id} approveAction={approveOne} />
                        ) : (
                          <Link
                            href={`/admin/business/hours/${h.id}`}
                            className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy hover:underline"
                          >
                            Open →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      <p className="mt-8 text-xs text-ink-500">
        Eligibility-regels: status <code>client_signed</code> · gewerkt
        binnen <code>±30 min</code> van gepland · geen chef-/klant-notities
        · tarieven gezet. Alles daarbuiten → handmatig keuren via detail.
      </p>
    </div>
  );
}

/* -------- bits ------------------------------------------------------- */

function explainAnomaly(r: {
  h: { startedAt: Date; endedAt: Date; breakMinutes: number; chefNotes: string | null; clientNotes: string | null };
  shiftStart: Date;
  shiftEnd: Date;
}): string | null {
  const scheduledMin =
    (new Date(r.shiftEnd).getTime() - new Date(r.shiftStart).getTime()) / 60000;
  const actualMin =
    (new Date(r.h.endedAt).getTime() - new Date(r.h.startedAt).getTime()) / 60000 -
    r.h.breakMinutes;
  const delta = actualMin - scheduledMin;
  if (Math.abs(delta) > 30) {
    return `${delta > 0 ? "+" : ""}${Math.round(delta)} min t.o.v. gepland`;
  }
  if (r.h.chefNotes?.trim()) return "Chef-opmerking";
  if (r.h.clientNotes?.trim()) return "Klant-opmerking";
  return null;
}

