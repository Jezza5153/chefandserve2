/**
 * /admin/business/integrations — the control room.
 *
 * PR-CHEF-0. Shows:
 *   - Connection cards per provider (payroll, accounting, email, calendar,
 *     backups, webhooks). Most are "Niet gekoppeld" in V1 — surfaces are
 *     ready, integrations land per future PR.
 *   - Latest integration runs (when workers/payroll-export etc. fire).
 *   - Outbox health (pending / failed counts + retry button).
 *   - Email delivery counts (last 7 days, with bounces).
 *
 * Super_admin only (server-enforced).
 */

import Link from "next/link";

import {
  emailCounts,
  getIntegrationHealth,
  listRecentBounces,
  listRecentRuns,
} from "@/lib/integrations";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Integraties", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requireRole("super_admin", undefined, { strict: true });

  const health = await getIntegrationHealth();
  const emails = await emailCounts(7);
  const recentRuns = await listRecentRuns(20);
  const recentBounces = await listRecentBounces(10);

  return (
    <div className="mx-auto max-w-5xl">
      <div>
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Systeem
        </p>
        <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
          Integraties
        </h1>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
          Eén overzicht van alles wat Chef &amp; Serve verbindt met de
          buitenwereld. Hier zie je wat aangesloten is, wat klaar staat,
          wat mislukt is, en wat je opnieuw kunt proberen.
        </p>
      </div>

      {/* Connection cards */}
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <ConnectionCard
          title="Payingit / Payroll"
          status="Niet gekoppeld · CSV export klaar"
          tone="amber"
          subnote="Phase 5 — live API. V1 = CSV download."
          actionHref="/admin/business/payroll"
          actionLabel="Bekijk batches →"
        />
        <ConnectionCard
          title="Boekhouding"
          status="Niet gekoppeld"
          tone="gray"
          subnote="Exact / Moneybird / AFAS — adapter pattern."
        />
        <ConnectionCard
          title="E-mail bezorging (Resend)"
          status={`Actief · ${emails.bounced} bounces / ${emails.delivered} bezorgd (7d)`}
          tone={emails.bounced > 0 ? "amber" : "green"}
          subnote="Realtime via webhook → email_messages."
          actionHref="#bounces"
          actionLabel="Bekijk bounces ↓"
        />
        <ConnectionCard
          title="Calendar feeds (ICS)"
          status="Nog niet gepubliceerd"
          tone="gray"
          subnote="PR-CHEF-11 — chef + klant ICS-feed met token."
        />
        <ConnectionCard
          title="Backups"
          status={
            health.lastBackupAt
              ? `Laatste: ${formatDate(health.lastBackupAt)}`
              : "Nog niet gepland"
          }
          tone={health.lastBackupAt ? "green" : "gray"}
          subnote="Wekelijkse pg_dump → encrypted .age op Mac Mini."
        />
        <ConnectionCard
          title="Webhooks / API"
          status="Uitgeschakeld"
          tone="gray"
          subnote="Reserved schemas. Geen publieke API in V1."
        />
      </div>

      {/* Outbox */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900">Outbox</h2>
          <Link
            href="/admin/business/integrations/outbox"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Bekijk alles →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatBox
            label="Wachtend"
            value={health.outboxPending}
            tone={health.outboxPending > 0 ? "amber" : "gray"}
          />
          <StatBox
            label="Mislukt"
            value={health.outboxFailed}
            tone={health.outboxFailed > 0 ? "burgundy" : "gray"}
          />
          <StatBox
            label="E-mail bounces (7d)"
            value={emails.bounced}
            tone={emails.bounced > 0 ? "amber" : "gray"}
          />
        </div>
      </section>

      {/* Recent runs */}
      <section className="mt-12">
        <h2 className="font-serif text-xl text-ink-900">
          Laatste integratie-runs
        </h2>
        {recentRuns.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-bg-gray p-6 text-center text-sm text-ink-500">
            Nog geen runs uitgevoerd.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-bg-gray text-left">
                <tr>
                  <th className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Provider
                  </th>
                  <th className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Type
                  </th>
                  <th className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Status
                  </th>
                  <th className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Items
                  </th>
                  <th className="px-3 py-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                    Wanneer
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r, i) => (
                  <tr
                    key={r.id}
                    className={
                      i < recentRuns.length - 1 ? "border-b border-ink-200" : ""
                    }
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.provider}</td>
                    <td className="px-3 py-2 text-xs text-ink-700">{r.runType}</td>
                    <td className="px-3 py-2 text-xs">
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-700">
                      {r.successCount ?? 0}/{r.totalItems ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500">
                      {r.finishedAt ? formatRelative(r.finishedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent bounces */}
      <section id="bounces" className="mt-12">
        <h2 className="font-serif text-xl text-ink-900">
          E-mail bounces (laatste 7 dagen)
        </h2>
        {recentBounces.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-bg-gray p-6 text-center text-sm text-ink-500">
            Geen bounces — alle e-mails komen aan.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {recentBounces.map((b) => (
              <li
                key={b.id}
                className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs text-ink-700">
                      {b.toEmail}
                    </span>{" "}
                    <span className="text-ink-500">·</span>{" "}
                    <span className="text-xs text-ink-700">{b.template}</span>
                  </div>
                  <span className="text-xs text-ink-500">
                    {formatRelative(b.createdAt)}
                  </span>
                </div>
                {b.error ? (
                  <p className="mt-1 text-xs text-burgundy">{b.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- helpers --------------------------------------------------- */

type Tone = "gray" | "green" | "amber" | "burgundy";

function ConnectionCard({
  title,
  status,
  tone,
  subnote,
  actionHref,
  actionLabel,
}: {
  title: string;
  status: string;
  tone: Tone;
  subnote?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const dot =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : tone === "burgundy"
          ? "bg-burgundy"
          : "bg-ink-200";
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-base text-ink-900">{title}</h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-700">
            <span className={`inline-block size-2 rounded-full ${dot}`} />
            {status}
          </p>
          {subnote ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{subnote}</p>
          ) : null}
        </div>
      </div>
      {actionHref ? (
        <Link
          href={actionHref}
          className="mt-3 inline-block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Tone;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : tone === "burgundy"
        ? "border-burgundy/30 bg-burgundy/5 text-burgundy"
        : "border-ink-200 bg-white text-ink-700";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] opacity-80">
        {label}
      </p>
      <p className="mt-1 font-serif text-3xl">{value}</p>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const cls =
    status === "success"
      ? "bg-emerald-100 text-emerald-700"
      : status === "partial"
        ? "bg-amber-100 text-amber-800"
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

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - dt.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "zojuist";
  if (min < 60) return `${min} min geleden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} u geleden`;
  const d2 = Math.floor(hr / 24);
  if (d2 < 30) return `${d2} d geleden`;
  return formatDate(dt);
}
