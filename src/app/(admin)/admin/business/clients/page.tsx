import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Klanten" };

type FilterStatus = "all" | "prospect" | "active" | "paused" | "archived";

export default async function ClientsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: FilterStatus; q?: string }>;
}) {
  await requirePermission("clients", "write");
  const params = await searchParams;
  const status: FilterStatus = params.status ?? "active";
  const q = params.q?.trim() ?? "";

  const whereParts = [isNull(clients.deletedAt)];
  if (status !== "all") whereParts.push(eq(clients.status, status));
  if (q) {
    whereParts.push(
      or(
        like(clients.companyName, `%${q}%`),
        like(clients.contactName, `%${q}%`),
        like(clients.email, `%${q}%`),
        like(clients.city, `%${q}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      email: clients.email,
      phone: clients.phone,
      segment: clients.segment,
      city: clients.city,
      status: clients.status,
      joinedAt: clients.joinedAt,
    })
    .from(clients)
    .where(and(...whereParts))
    .orderBy(desc(clients.joinedAt))
    .limit(200);

  const counts = await db
    .select({ status: clients.status, n: sql<number>`count(*)::int` })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .groupBy(clients.status);

  const countByStatus = (s: FilterStatus): number =>
    s === "all"
      ? counts.reduce((a, c) => a + c.n, 0)
      : counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Operations
          </p>
          <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
            Klanten
          </h1>
        </div>
        <span className="rounded-full bg-burgundy/10 px-3 py-1 font-ui text-[11px] font-medium text-burgundy">
          {countByStatus("all")} totaal
        </span>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {(["active", "prospect", "paused", "archived", "all"] as FilterStatus[]).map((s) => (
          <FilterPill
            key={s}
            label={`${statusLabel(s)} (${countByStatus(s)})`}
            active={status === s}
            href={qs({ status: s, q })}
          />
        ))}
        <form
          action="/admin/business/clients"
          className="ml-auto flex items-center gap-2"
        >
          {status !== "active" && (
            <input type="hidden" name="status" value={status} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Zoek op bedrijf, naam, e-mail, stad…"
            className="rounded border border-ink-200 bg-white px-3 py-2 text-sm placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
          <button
            type="submit"
            className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
          >
            Zoek
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">
            Geen klanten gevonden
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Klanten verschijnen hier zodra een aanvraag wordt geconverteerd in de{" "}
            <Link href="/admin/business/inbox" className="text-burgundy hover:underline">
              inbox
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full">
            <thead className="bg-bg-gray text-left">
              <tr>
                <Th>Bedrijf</Th>
                <Th>Contactpersoon</Th>
                <Th>Segment</Th>
                <Th>Stad</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/business/clients/${r.id}`}
                      className="font-serif text-sm text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {r.companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.contactName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.segment ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.city ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.email ?? r.phone ?? "—"}
                  </td>
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

function FilterPill({
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
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "prospect"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {statusLabel(status as FilterStatus)}
    </span>
  );
}

function statusLabel(s: FilterStatus): string {
  return (
    ({
      all: "Alle",
      prospect: "Prospect",
      active: "Actief",
      paused: "Gepauzeerd",
      archived: "Gearchiveerd",
    } as const)[s] ?? s
  );
}

function qs({ status, q }: { status: FilterStatus; q: string }) {
  const sp = new URLSearchParams();
  if (status !== "active") sp.set("status", status);
  if (q) sp.set("q", q);
  const s = sp.toString();
  return `/admin/business/clients${s ? `?${s}` : ""}`;
}
