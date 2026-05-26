import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients, shifts } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Shifts" };

type Tab = "upcoming" | "open" | "past" | "all";

export default async function ShiftsListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab }>;
}) {
  await requireRole("owner");
  const params = await searchParams;
  const tab: Tab = params.tab ?? "upcoming";
  const now = new Date();

  const whereParts = [];
  if (tab === "upcoming") {
    whereParts.push(gt(shifts.startsAt, now));
  } else if (tab === "open") {
    whereParts.push(eq(shifts.status, "open"));
  } else if (tab === "past") {
    whereParts.push(lt(shifts.startsAt, now));
  }

  const rows = await db
    .select({
      id: shifts.id,
      clientId: shifts.clientId,
      clientName: clients.companyName,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      segment: shifts.segment,
      headcount: shifts.headcount,
      city: shifts.city,
      status: shifts.status,
    })
    .from(shifts)
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(whereParts.length > 0 ? and(...whereParts) : undefined)
    .orderBy(tab === "past" ? desc(shifts.startsAt) : shifts.startsAt)
    .limit(200);

  const counts = await db
    .select({
      open: sql<number>`count(*) filter (where ${shifts.status} = 'open')::int`,
      filled: sql<number>`count(*) filter (where ${shifts.status} = 'filled')::int`,
      upcoming: sql<number>`count(*) filter (where ${shifts.startsAt} > now() AND ${shifts.status} != 'cancelled')::int`,
    })
    .from(shifts)
    .where(isNotNull(shifts.id));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Operations
          </p>
          <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
            Shifts
          </h1>
        </div>
        <Link
          href="/admin/business/shifts/new"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          + Nieuwe shift
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <TabPill label={`Komend (${counts[0]?.upcoming ?? 0})`} active={tab === "upcoming"} href="/admin/business/shifts" />
        <TabPill label={`Open (${counts[0]?.open ?? 0})`} active={tab === "open"} href="/admin/business/shifts?tab=open" />
        <TabPill label="Verleden" active={tab === "past"} href="/admin/business/shifts?tab=past" />
        <TabPill label="Alles" active={tab === "all"} href="/admin/business/shifts?tab=all" />
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">Geen shifts</p>
          <p className="mt-2 text-sm text-ink-500">
            Klik op &laquo;Nieuwe shift&raquo; om er een toe te voegen.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-ink-200 bg-white">
          <table className="w-full">
            <thead className="bg-bg-gray text-left">
              <tr>
                <Th>Datum / tijd</Th>
                <Th>Klant</Th>
                <Th>Rol</Th>
                <Th>Aantal</Th>
                <Th>Stad</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/admin/business/shifts/${r.id}`}
                      className="text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {formatDateRange(r.startsAt, r.endsAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    <Link
                      href={`/admin/business/clients/${r.clientId}`}
                      className="hover:text-burgundy hover:underline"
                    >
                      {r.clientName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.roleNeeded}
                    {r.segment && (
                      <span className="ml-1 text-ink-500">· {r.segment}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">{r.headcount}</td>
                  <td className="px-4 py-3 text-xs text-ink-700">{r.city ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
      {children}
    </th>
  );
}

function TabPill({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] transition-colors ${
        active
          ? "bg-burgundy text-white"
          : "bg-bg-gray text-ink-700 hover:bg-burgundy/10 hover:text-burgundy"
      }`}
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "open"
      ? "bg-amber-100 text-amber-700"
      : status === "filled"
        ? "bg-emerald-100 text-emerald-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : status === "cancelled"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    request: "Aanvraag",
    open: "Open",
    filled: "Bemand",
    completed: "Afgerond",
    cancelled: "Geannuleerd",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function formatDateRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
