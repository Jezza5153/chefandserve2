/**
 * /admin/system/privacy-requests — AVG fulfillment cockpit (PR-AVG-1).
 * super_admin only. Surfaces overdue + waiting-on-identity so nothing breaches
 * the 30-day SLA. Off-portal requests are created via /new.
 */

import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { privacyRequests, users } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Privacyverzoeken" };
export const dynamic = "force-dynamic";

type Filter = "open" | "overdue" | "due_week" | "waiting_identity" | "closed" | "all";
const OPEN = ["pending", "in_progress"] as const;

export default async function PrivacyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: Filter }>;
}) {
  await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
  const filter: Filter = (await searchParams).filter ?? "open";

  const rows = await db
    .select({
      r: privacyRequests,
      userEmail: users.email,
      userName: users.name,
    })
    .from(privacyRequests)
    .leftJoin(users, eq(users.id, privacyRequests.userId))
    .orderBy(desc(privacyRequests.createdAt))
    .limit(200);

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const isOpen = (s: string) => (OPEN as readonly string[]).includes(s);
  const enriched = rows.map(({ r, userEmail, userName }) => {
    const due = new Date(r.dueDate).getTime();
    return {
      r,
      label: r.requesterName ?? userName ?? r.requesterEmail ?? userEmail ?? "onbekend",
      open: isOpen(r.status),
      overdue: isOpen(r.status) && due < now,
      dueSoon: isOpen(r.status) && due >= now && due - now < weekMs,
      waitingId: isOpen(r.status) && r.identityStatus !== "verified",
      daysLeft: Math.ceil((due - now) / (24 * 60 * 60 * 1000)),
    };
  });

  const counts = {
    open: enriched.filter((e) => e.open).length,
    overdue: enriched.filter((e) => e.overdue).length,
    dueSoon: enriched.filter((e) => e.dueSoon).length,
    waitingId: enriched.filter((e) => e.waitingId).length,
  };

  const shown = enriched.filter((e) => {
    switch (filter) {
      case "open": return e.open;
      case "overdue": return e.overdue;
      case "due_week": return e.dueSoon;
      case "waiting_identity": return e.waitingId;
      case "closed": return !e.open;
      case "all": return true;
    }
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">System</p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Privacyverzoeken</h1>
        </div>
        <Link
          href="/admin/system/privacy-requests/new"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          + Handmatig verzoek
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-500">
        AVG-verzoeken (inzage · export · correctie · verwijdering). Wettelijke
        reactietermijn: 30 dagen. Verifieer altijd eerst de identiteit.
      </p>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Stat label="Open" n={counts.open} tone="neutral" />
        <Stat label="🔴 Verlopen" n={counts.overdue} tone="red" />
        <Stat label="⚠ Bijna te laat" n={counts.dueSoon} tone="amber" />
        <Stat label="🟡 Wacht op identiteit" n={counts.waitingId} tone="amber" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["open", "overdue", "due_week", "waiting_identity", "closed", "all"] as Filter[]).map((f) => (
          <Link
            key={f}
            href={`/admin/system/privacy-requests?filter=${f}`}
            className={`rounded-full px-3 py-1.5 font-ui text-[10px] uppercase tracking-[0.15em] ${
              filter === f ? "bg-burgundy text-white" : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
            }`}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-10 text-center text-sm text-ink-500">
          Geen verzoeken in deze weergave.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {shown.map(({ r, label, overdue, daysLeft }) => (
            <li key={r.id}>
              <Link
                href={`/admin/system/privacy-requests/${r.id}`}
                className="block rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-serif text-base text-ink-900">
                    {label} · <span className="text-ink-500">{TYPE_LABELS[r.type] ?? r.type}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <IdentityPill status={r.identityStatus} />
                    <StatusPill status={r.status} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  Kanaal: {r.originalChannel} ·{" "}
                  {(OPEN as readonly string[]).includes(r.status)
                    ? overdue
                      ? `🔴 ${Math.abs(daysLeft)} dagen te laat`
                      : `nog ${daysLeft} dagen`
                    : "afgesloten"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<Filter, string> = {
  open: "Open", overdue: "Verlopen", due_week: "Deze week",
  waiting_identity: "Wacht op identiteit", closed: "Afgesloten", all: "Alle",
};
const TYPE_LABELS: Record<string, string> = {
  access: "Inzage", export: "Export", correction: "Correctie",
  deletion: "Verwijdering", other: "Overig",
};

function Stat({ label, n, tone }: { label: string; n: number; tone: "neutral" | "red" | "amber" }) {
  const c = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-ink-900";
  return (
    <span className="rounded-lg border border-ink-200 bg-white px-3 py-1.5">
      <span className={`font-serif text-lg ${c}`}>{n}</span>{" "}
      <span className="text-ink-500">{label}</span>
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Nieuw", in_progress: "In behandeling", fulfilled: "Afgehandeld",
    partially_fulfilled: "Deels afgehandeld", rejected: "Afgewezen", withdrawn: "Ingetrokken",
  };
  const tone =
    status === "fulfilled" ? "bg-emerald-100 text-emerald-700"
    : status === "in_progress" ? "bg-blue-100 text-blue-700"
    : status === "pending" ? "bg-amber-100 text-amber-800"
    : "bg-bg-gray text-ink-500";
  return <span className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}>{labels[status] ?? status}</span>;
}

function IdentityPill({ status }: { status: string }) {
  if (status === "verified") return null;
  const labels: Record<string, string> = {
    not_started: "Identiteit?", requested: "Identiteit gevraagd", failed: "Identiteit mislukt",
  };
  return <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">{labels[status] ?? status}</span>;
}
