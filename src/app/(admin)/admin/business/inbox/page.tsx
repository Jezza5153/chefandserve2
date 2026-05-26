import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefSubmissions, clientSubmissions } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Inbox" };

/** Possible filter values. Mirrors `submission_status` enum minus the all-purpose meta. */
type FilterStatus = "all" | "new" | "triaged" | "converted" | "rejected" | "duplicate";
type FilterKind = "all" | "chef" | "client";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: FilterStatus; kind?: FilterKind }>;
}) {
  await requireRole("owner");
  const params = await searchParams;
  const status: FilterStatus = params.status ?? "new";
  const kind: FilterKind = params.kind ?? "all";

  /* ----- queries ----------------------------------------------------- */
  const chefRowsPromise =
    kind === "client"
      ? Promise.resolve([])
      : db
          .select({
            id: chefSubmissions.id,
            kind: chefSubmissions.id, // placeholder; we set "chef" below
            fullName: chefSubmissions.fullName,
            email: chefSubmissions.email,
            phone: chefSubmissions.phone,
            rolesRequested: chefSubmissions.rolesRequested,
            notes: chefSubmissions.notes,
            status: chefSubmissions.status,
            createdAt: chefSubmissions.createdAt,
          })
          .from(chefSubmissions)
          .where(status === "all" ? undefined : eq(chefSubmissions.status, status))
          .orderBy(desc(chefSubmissions.createdAt))
          .limit(50);

  const clientRowsPromise =
    kind === "chef"
      ? Promise.resolve([])
      : db
          .select({
            id: clientSubmissions.id,
            kind: clientSubmissions.id,
            companyName: clientSubmissions.companyName,
            contactName: clientSubmissions.contactName,
            email: clientSubmissions.email,
            phone: clientSubmissions.phone,
            roleRequested: clientSubmissions.roleRequested,
            segment: clientSubmissions.segment,
            headcount: clientSubmissions.headcount,
            notes: clientSubmissions.notes,
            status: clientSubmissions.status,
            createdAt: clientSubmissions.createdAt,
          })
          .from(clientSubmissions)
          .where(status === "all" ? undefined : eq(clientSubmissions.status, status))
          .orderBy(desc(clientSubmissions.createdAt))
          .limit(50);

  const [chefRows, clientRows] = await Promise.all([chefRowsPromise, clientRowsPromise]);

  type Row =
    | {
        kind: "chef";
        id: string;
        title: string;
        subtitle: string;
        meta: string;
        status: string;
        createdAt: Date;
      }
    | {
        kind: "client";
        id: string;
        title: string;
        subtitle: string;
        meta: string;
        status: string;
        createdAt: Date;
      };

  const rows: Row[] = [
    ...chefRows.map((r) => ({
      kind: "chef" as const,
      id: r.id,
      title: r.fullName ?? "(naamloos)",
      subtitle: r.email ?? r.phone ?? "—",
      meta: r.rolesRequested ?? "Chef-aanmelding",
      status: r.status,
      createdAt: r.createdAt,
    })),
    ...clientRows.map((r) => ({
      kind: "client" as const,
      id: r.id,
      title: r.companyName ?? r.contactName ?? "(naamloos)",
      subtitle: r.email ?? r.phone ?? "—",
      meta:
        [
          r.roleRequested,
          r.headcount ? `${r.headcount}p` : null,
          r.segment,
        ]
          .filter(Boolean)
          .join(" · ") || "Klant-aanvraag",
      status: r.status,
      createdAt: r.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  /* ----- view -------------------------------------------------------- */
  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">Inbox</h1>
      <p className="mt-4 text-sm text-ink-700 md:text-base">
        Aanmeldingen van chefs (work-with-us) en klanten (contact-us). Stuur
        Jotform webhooks naar{" "}
        <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">
          /api/intake/chef
        </code>{" "}
        en{" "}
        <code className="rounded bg-bg-gray px-1.5 py-0.5 text-xs">
          /api/intake/client
        </code>
        .
      </p>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <FilterPill label="Alle types" active={kind === "all"} href={qs({ kind: "all", status })} />
        <FilterPill label="Chefs" active={kind === "chef"} href={qs({ kind: "chef", status })} />
        <FilterPill label="Klanten" active={kind === "client"} href={qs({ kind: "client", status })} />
        <span className="mx-2 h-4 w-px bg-ink-200" aria-hidden />
        {(["new", "triaged", "converted", "rejected", "all"] as FilterStatus[]).map((s) => (
          <FilterPill
            key={s}
            label={statusLabel(s)}
            active={status === s}
            href={qs({ kind, status: s })}
          />
        ))}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">
            {status === "new"
              ? "Geen nieuwe aanmeldingen"
              : `Geen aanmeldingen met status "${statusLabel(status)}"`}
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Wanneer Jotform webhooks aankomen verschijnen ze hier.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={`/admin/business/inbox/${r.kind}/${r.id}`}
                className="block rounded-lg border border-ink-200 bg-white p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KindBadge kind={r.kind} />
                      <h3 className="font-serif text-lg text-ink-900">
                        {r.title}
                      </h3>
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{r.subtitle}</p>
                    <p className="mt-1 text-xs text-ink-500">{r.meta}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-ink-500">
                      {new Date(r.createdAt).toLocaleString("nl-NL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- */

function qs({ kind, status }: { kind: FilterKind; status: FilterStatus }) {
  const sp = new URLSearchParams();
  if (kind !== "all") sp.set("kind", kind);
  if (status !== "new") sp.set("status", status);
  const qs = sp.toString();
  return `/admin/business/inbox${qs ? `?${qs}` : ""}`;
}

function statusLabel(s: FilterStatus): string {
  return (
    {
      all: "Alle statussen",
      new: "Nieuw",
      triaged: "In behandeling",
      converted: "Geconverteerd",
      rejected: "Afgewezen",
      duplicate: "Dubbel",
    } as const
  )[s];
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

function KindBadge({ kind }: { kind: "chef" | "client" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-ui text-[9px] font-medium uppercase tracking-wider ${
        kind === "chef"
          ? "bg-cream/40 text-burgundy"
          : "bg-burgundy/10 text-burgundy"
      }`}
    >
      {kind === "chef" ? "Chef" : "Klant"}
    </span>
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
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {statusLabel(status as FilterStatus)}
    </span>
  );
}
