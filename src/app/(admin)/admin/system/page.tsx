/**
 * /admin/system — super-admin command center (Cockpit UX, Phase A: read-only).
 *
 * Find platform problems fast: health row → ranked Aandacht-nodig (errors ·
 * outbox · privacy SLA · backup · webhooks) → Verbruik & kosten (e-mail live ·
 * WhatsApp manual · AI concept) → recente errors → KPI strip → footer. Plus a
 * disabled "Bekijk als" panel (wired in Phase B). Real signals only.
 */

import Link from "next/link";
import { and, desc, gte, inArray, isNull, sql } from "drizzle-orm";

import { Icon, type IconName } from "@/components/admin/icons";
import { OpsCard } from "@/components/dashboard/OpsCard";
import { db } from "@/lib/db/client";
import {
  auditLog,
  backupRuns,
  contactLogs,
  emailMessages,
  errorLog,
  payrollBatches,
  privacyRequests,
  users,
  webhooksReceived,
} from "@/lib/db/schema";
import {
  rankSystemItems,
  systemHealthRollup,
  type SystemAttentionItem,
  type SystemTone,
} from "@/lib/domain/system-intel";
import { env } from "@/lib/env";
import { getIntegrationHealth } from "@/lib/integrations";
import { getAiUsageSummary } from "@/lib/ai/read-model/ai-usage";
import { requirePermission } from "@/lib/permissions";
import { r2IsConfigured } from "@/lib/r2";

export const metadata = { title: "Systeem" };
export const dynamic = "force-dynamic";

const DAY = 864e5;
const BOUNCE_SPIKE = 5; // bounces (7d) at/above this = surfaced

export default async function SystemDashboardPage() {
  await requirePermission("system", "read");

  const now = new Date();
  const since24h = new Date(now.getTime() - DAY);
  const since7d = new Date(now.getTime() - 7 * DAY);
  const since30d = new Date(now.getTime() - 30 * DAY);

  const [
    dbOk,
    health,
    [{ usersTotal }],
    [{ usersActive }],
    [{ openErrors }],
    [{ criticalOpen }],
    recentErrors,
    emailRows,
    [{ whatsapp30d }],
    openPrivacy,
    [{ auditCount24h }],
    [{ webhookFailures7d }],
    [latestBackup],
    [latestPayroll],
    aiUsage,
  ] = await Promise.all([
    db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
    getIntegrationHealth(),
    db.select({ usersTotal: sql<number>`count(*)::int` }).from(users),
    db.select({ usersActive: sql<number>`count(*)::int` }).from(users).where(sql`${users.status} = 'active'`),
    // PR-AUDIT-6b: CSP report-only beacons land in error_log at severity 'info'
    // (context.csp=true). They're telemetry, not faults — exclude from the
    // "open errors" KPI so it reflects real, actionable failures.
    db.select({ openErrors: sql<number>`count(*)::int` }).from(errorLog).where(and(isNull(errorLog.resolvedAt), sql`${errorLog.context}->>'csp' IS DISTINCT FROM 'true'`)),
    db.select({ criticalOpen: sql<number>`count(*)::int` }).from(errorLog).where(and(isNull(errorLog.resolvedAt), sql`${errorLog.severity} = 'critical'`)),
    db.select({ id: errorLog.id, message: errorLog.message, severity: errorLog.severity, createdAt: errorLog.createdAt, resolvedAt: errorLog.resolvedAt }).from(errorLog).where(sql`${errorLog.context}->>'csp' IS DISTINCT FROM 'true'`).orderBy(desc(errorLog.createdAt)).limit(6),
    db.select({ status: emailMessages.status, n: sql<number>`count(*)::int` }).from(emailMessages).where(gte(emailMessages.createdAt, since30d)).groupBy(emailMessages.status),
    db.select({ whatsapp30d: sql<number>`count(*)::int` }).from(contactLogs).where(and(sql`${contactLogs.channel} = 'whatsapp'`, gte(contactLogs.createdAt, since30d))),
    db.select({ dueDate: privacyRequests.dueDate }).from(privacyRequests).where(inArray(privacyRequests.status, ["pending", "in_progress"])),
    db.select({ auditCount24h: sql<number>`count(*)::int` }).from(auditLog).where(gte(auditLog.createdAt, since24h)),
    db.select({ webhookFailures7d: sql<number>`count(*)::int` }).from(webhooksReceived).where(and(gte(webhooksReceived.createdAt, since7d), sql`${webhooksReceived.processingError} IS NOT NULL`)),
    db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(1),
    db.select({ exportedAt: payrollBatches.exportedAt, createdAt: payrollBatches.createdAt }).from(payrollBatches).orderBy(desc(payrollBatches.createdAt)).limit(1),
    getAiUsageSummary({ now }),
  ]);

  /* ---- health components (reuse /api/health primitives directly) ---- */
  const components: { label: string; status: "ok" | "missing" | "error" }[] = [
    { label: "Database", status: dbOk ? "ok" : "error" },
    { label: "E-mail", status: env.RESEND_API_KEY ? "ok" : "missing" },
    { label: "Opslag (R2)", status: r2IsConfigured() ? "ok" : "missing" },
    { label: "Auth", status: env.AUTH_SECRET ? "ok" : "missing" },
  ];
  const healthDown = components.some((c) => c.status !== "ok");

  /* ---- backup: only alarm when backups exist and the latest is bad/stale ---- */
  const hasBackups = !!latestBackup;
  const backupAge = latestBackup ? now.getTime() - new Date(latestBackup.startedAt).getTime() : 0;
  const backupStale = hasBackups && (latestBackup!.status !== "ok" || backupAge > 8 * DAY);

  /* ---- e-mail 30d ---- */
  const emailBy = new Map<string, number>(emailRows.map((r) => [r.status as string, r.n]));
  const emailDelivered = emailBy.get("delivered") ?? 0;
  const emailBounced30 = emailBy.get("bounced") ?? 0;
  const emailFailed = emailBy.get("failed") ?? 0;
  const emailTotal30 = ["sent", "delivered", "bounced", "failed", "complained"].reduce((s, k) => s + (emailBy.get(k) ?? 0), 0);
  const emailDeliveredPct = emailTotal30 > 0 ? Math.round((emailDelivered / emailTotal30) * 100) : null;
  // PR-AUDIT-9: denominator must include sent/failed/complained (match the 30d
  // calc), not just delivered+bounced — else the 7d delivery-rate reads high.
  const delivered7Total = health.emailTotalLast7d;
  const deliveredPct7 = delivered7Total > 0 ? Math.round((health.emailDeliveredLast7d / delivered7Total) * 100) : null;

  /* ---- privacy SLA ---- */
  const openPrivacyCount = openPrivacy.length;
  const privacyOverdue = openPrivacy.filter((r) => new Date(r.dueDate) < now).length;
  const privacyDueSoon = openPrivacy.filter((r) => {
    const d = new Date(r.dueDate).getTime();
    return d >= now.getTime() && d <= now.getTime() + 7 * DAY;
  }).length;

  /* ---- build + rank the Aandacht-nodig queue ---- */
  const items: SystemAttentionItem[] = [];
  if (criticalOpen > 0)
    items.push({ kind: "critical_error", tone: "red", icon: "alert-triangle", title: `${criticalOpen} onopgeloste critical error${criticalOpen === 1 ? "" : "s"}`, detail: recentErrors[0]?.message?.slice(0, 64), href: "/admin/system/errors", cta: "Bekijk" });
  if (health.outboxFailed > 0)
    items.push({ kind: "failed_outbox", tone: "amber", icon: "refresh-cw", title: `${health.outboxFailed} outbox-event${health.outboxFailed === 1 ? "" : "s"} mislukt`, detail: "levering aan een provider faalde", href: "/admin/business/integrations", cta: "Replay" });
  if (privacyOverdue > 0)
    items.push({ kind: "privacy_overdue", tone: "red", icon: "shield-check", title: `${privacyOverdue} privacyverzoek${privacyOverdue === 1 ? "" : "en"} over tijd`, detail: "SLA-deadline (AVG art. 12) verstreken", href: "/admin/system/privacy-requests", cta: "Behandel" });
  if (backupStale)
    items.push({ kind: "backup_failed", tone: "red", icon: "clock", title: "Laatste backup mislukt of verouderd", detail: latestBackup ? `status: ${latestBackup.status}` : undefined, href: "/admin/system/retention", cta: "Bekijk" });
  if (healthDown)
    items.push({ kind: "health_failing", tone: "red", icon: "activity", title: "Health check meldt een probleem", detail: components.filter((c) => c.status !== "ok").map((c) => c.label).join(", "), href: "/admin/system/health", cta: "Bekijk" });
  if (health.emailBouncesLast7d >= BOUNCE_SPIKE)
    items.push({ kind: "email_bounce_spike", tone: "amber", icon: "mail", title: `${health.emailBouncesLast7d} e-mail bounces (7d)`, detail: "controleer afzender/domein-reputatie", href: "/admin/system/emails", cta: "Bekijk" });
  if (webhookFailures7d > 0)
    items.push({ kind: "webhook_failure", tone: "amber", icon: "arrow-right", title: `${webhookFailures7d} webhook-fout${webhookFailures7d === 1 ? "" : "en"} (7d)`, href: "/admin/system/webhooks", cta: "Bekijk" });
  if (privacyDueSoon > 0)
    items.push({ kind: "privacy_due_soon", tone: "blue", icon: "shield-check", title: `${privacyDueSoon} privacyverzoek${privacyDueSoon === 1 ? "" : "en"} deze week`, detail: "binnen SLA, maar plan in", href: "/admin/system/privacy-requests", cta: "Plan" });

  const ranked = rankSystemItems(items);
  const rollup = systemHealthRollup({
    criticalErrors: criticalOpen,
    healthDown,
    backupFailedOrStale: backupStale,
    outboxFailed: health.outboxFailed,
    webhookFailures: webhookFailures7d,
    privacyOverdue,
  });

  const ROLLUP_META: Record<typeof rollup, { dot: string; text: string; label: string }> = {
    operationeel: { dot: "bg-emerald-500", text: "text-emerald-700", label: "Kern operationeel" },
    aandacht: { dot: "bg-amber-500", text: "text-amber-800", label: "Aandacht nodig" },
    kritiek: { dot: "bg-red-500", text: "text-red-700", label: "Kritiek" },
  };
  const rm = ROLLUP_META[rollup];

  const subtitle =
    ranked.length > 0
      ? `${ranked.length} ${ranked.length === 1 ? "ding vraagt" : "dingen vragen"} aandacht — pak deze eerst.`
      : "Kern operationeel. Geen urgente systeemproblemen.";
  const dateLabel = cap(now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }));

  return (
    <div className="-mx-6 -my-10 md:-mx-10 md:-my-12">
      <div className="px-6 py-7 md:px-10 md:py-8">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-ui text-[11px] uppercase tracking-[0.2em] text-ink-500">System · Beheerder</p>
            <h1 className="mt-1 font-serif text-3xl text-ink-900 md:text-4xl">Systeemstatus</h1>
            <p className="mt-1 text-sm text-ink-700">{subtitle}</p>
          </div>
          <span className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 font-ui text-[12px] text-ink-700">
            <Icon name="calendar" className="h-4 w-4" /> {dateLabel}
          </span>
        </div>

        {/* Toolbar */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/admin/system/health" className="flex items-center gap-2 rounded-full bg-burgundy px-4 py-2 font-ui text-[12px] font-medium text-white hover:bg-burgundy-900"><Icon name="activity" className="h-4 w-4" /> Health check</Link>
          <Link href="/admin/business/integrations" className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[12px] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"><Icon name="refresh-cw" className="h-4 w-4" /> Replay outbox</Link>
          <Link href="/admin/system/audit" className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[12px] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"><Icon name="list" className="h-4 w-4" /> Audit log</Link>
          <Link href="/admin/system/users" className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[12px] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"><Icon name="users" className="h-4 w-4" /> Gebruikers</Link>
          <span className="flex items-center gap-2 rounded-full border border-dashed border-ink-200 px-4 py-2 font-ui text-[12px] text-ink-400" title="Beschikbaar in Fase B"><Icon name="eye" className="h-4 w-4" /> Bekijk als <span className="rounded-full bg-bg-gray px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">Fase B</span></span>
        </div>

        {/* Health row */}
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className={`rounded-xl border p-4 ${rollup === "kritiek" ? "border-red-200 bg-red-50/50" : rollup === "aandacht" ? "border-amber-300 bg-amber-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
            <div className="flex items-center justify-between">
              <p className={`font-ui text-[11px] font-semibold uppercase tracking-[0.16em] ${rm.text}`}>Applicatie</p>
              <Icon name={rollup === "operationeel" ? "check-circle" : "alert-triangle"} className={`h-5 w-5 ${rm.text}`} />
            </div>
            <p className="mt-2 font-serif text-xl text-ink-900">{rm.label}</p>
            <p className="text-xs text-ink-500">{components.map((c) => `${c.label} ${c.status === "ok" ? "✓" : c.status}`).join(" · ")}</p>
          </div>
          <div className={`rounded-xl border p-4 ${health.outboxFailed > 0 ? "border-amber-300 bg-amber-50/50" : "border-ink-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-700">Integraties</p>
              <Icon name="refresh-cw" className={`h-5 w-5 ${health.outboxFailed > 0 ? "text-amber-600" : "text-ink-500"}`} />
            </div>
            <p className="mt-2 font-serif text-xl text-ink-900">{health.outboxFailed > 0 ? `${health.outboxFailed} mislukt` : "Operationeel"}</p>
            <p className="text-xs text-ink-500">outbox {health.outboxPending} wachtend · {webhookFailures7d} webhook-fouten (7d)</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-700">Jobs &amp; backup</p>
              <Icon name="clock" className="h-5 w-5 text-ink-500" />
            </div>
            <p className="mt-2 font-serif text-xl text-ink-900">{!hasBackups ? "Niet geconfigureerd" : backupStale ? "Aandacht" : "Op schema"}</p>
            <p className="text-xs text-ink-500">{hasBackups ? `laatste backup ${fmtDate(latestBackup!.startedAt)} · ${latestBackup!.status}` : "nog geen backup-run geregistreerd"}</p>
          </div>
        </section>

        {/* Verbruik & kosten */}
        <section className="mt-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-ink-900">Verbruik &amp; kosten</h2>
            <span className="font-ui text-[11px] text-ink-500">laatste 30 dagen · kosten volgen zodra tarieven bekend zijn</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <VerbruikCard icon="mail" title="E-mail" badge={{ text: "Live · 30d", tone: "green" }} value={emailTotal30.toLocaleString("nl-NL")} unit="verzonden"
              lines={[emailDeliveredPct != null ? `${emailDeliveredPct}% bezorgd · ${emailBounced30} bounces · ${emailFailed} mislukt` : "nog geen verzonden e-mail"]} href="/admin/system/emails" linkLabel="E-mail log" />
            <VerbruikCard icon="message-circle" title="WhatsApp" badge={{ text: "Handmatig", tone: "amber" }} value={whatsapp30d.toLocaleString("nl-NL")} unit="berichten gestart"
              lines={["via deep-link · API binnenkort"]} href="/admin/business/chefs" linkLabel="Contactlog" />
            <VerbruikCard icon="sparkles" title="AI-tokens"
              badge={aiUsage.turns > 0 ? { text: "Live · 30d", tone: "green" } : { text: "Concept", tone: "grey" }}
              value={aiUsage.totalTokens > 0 ? aiUsage.totalTokens.toLocaleString("nl-NL") : "—"} unit="tokens" concept={aiUsage.turns === 0}
              lines={aiUsage.turns > 0
                ? [`${aiUsage.turns} beurten · ${aiUsage.promptTokens.toLocaleString("nl-NL")} in / ${aiUsage.completionTokens.toLocaleString("nl-NL")} uit`]
                : ["nog geen tokenlog", "wordt gemeten zodra de assistent draait"]}
              cost={aiUsage.totalTokens === 0
                ? "n.t.b."
                : aiUsage.cost
                  ? aiUsage.cost.amount.toLocaleString("nl-NL", { style: "currency", currency: aiUsage.cost.currency, maximumFractionDigits: 2 })
                  : "stel tarief in (env)"} />
          </div>
        </section>

        {/* Errors + Aandacht-nodig + Bekijk-als */}
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-serif text-xl text-ink-900">Recente errors</h2>
              <Link href="/admin/system/errors" className="flex items-center gap-1 font-ui text-[12px] font-medium text-burgundy hover:underline">Alle errors <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
            </div>
            {recentErrors.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-500">Geen errors gelogd. ✓</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-y border-ink-100 font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500"><th className="px-5 py-2 text-left font-medium">Ernst</th><th className="px-2 py-2 text-left font-medium">Bericht</th><th className="px-2 py-2 text-left font-medium">Wanneer</th><th></th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {recentErrors.map((e) => (
                    <tr key={e.id} className="hover:bg-bg-gray">
                      <td className="px-5 py-3 align-top"><span className={`rounded-full px-2 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-wider ${SEVERITY_TONE[e.severity] ?? "bg-bg-gray text-ink-700"}`}>{e.severity}</span></td>
                      <td className="px-2 py-3 align-top text-ink-900">{e.message}</td>
                      <td className="px-2 py-3 align-top text-xs text-ink-500 whitespace-nowrap">{fmtDateTime(e.createdAt)}{e.resolvedAt ? " · ✓" : ""}</td>
                      <td className="px-3 py-3 align-top text-ink-500"><Link href="/admin/system/errors"><Icon name="chevron-right" className="h-[18px] w-[18px]" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Link href="/admin/system/audit" className="flex items-center gap-1 px-5 py-3 font-ui text-[12px] font-medium text-burgundy hover:underline">Naar audit log <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
          </section>

          <div className="space-y-5">
            <section className="rounded-xl border border-ink-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg text-ink-900">Aandacht nodig</h2>
                {ranked.length > 0 && <span className="rounded-full bg-burgundy px-1.5 py-0.5 text-[10px] font-semibold text-white">{ranked.length}</span>}
              </div>
              {ranked.length === 0 ? (
                <div className="mt-3 rounded-lg bg-bg-gray px-3 py-4">
                  <p className="text-sm text-ink-900">Geen urgente acties.</p>
                  <p className="mt-0.5 text-xs text-ink-500">Alle systemen draaien zonder gemelde problemen.</p>
                </div>
              ) : (
                <div className="mt-3 divide-y divide-ink-100">
                  {ranked.map((it, i) => (
                    <Link key={i} href={it.href} className="-mx-2 flex items-start gap-3 rounded px-2 py-3 hover:bg-bg-gray">
                      <span className={`mt-0.5 ${TONE_ICON[it.tone]}`}><Icon name={it.icon} className="h-[18px] w-[18px]" /></span>
                      <div className="min-w-0 flex-1"><p className="text-sm text-ink-900">{it.title}</p>{it.detail && <p className="truncate text-xs text-ink-500">{it.detail}</p>}</div>
                      {it.cta && <span className="mt-0.5 shrink-0 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy">{it.cta}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Bekijk als — Phase A: UI only, disabled */}
            <section className="rounded-xl border border-ink-200 bg-white p-5">
              <div className="flex items-center gap-2"><Icon name="eye" className="text-burgundy" /><h2 className="font-serif text-lg text-ink-900">Wat ziet het team?</h2><span className="rounded-full bg-bg-gray px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-500">Fase B</span></div>
              <p className="mt-1 text-xs text-ink-500">Straks: zoek een chef, klant of teamlid en open hun scherm zoals zij het zien.</p>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-ink-200 bg-bg-gray/50 px-3 py-2 text-ink-400">
                <Icon name="search" className="h-4 w-4" />
                <span className="text-sm">Zoek gebruiker… (binnenkort)</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["Chefs", "Klanten", "Team"].map((f) => (
                  <span key={f} className="rounded-full border border-ink-200 px-2.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-ink-400">{f}</span>
                ))}
              </div>
              <Link href="/admin/system/users" className="mt-3 flex items-center gap-1 font-ui text-[12px] font-medium text-burgundy hover:underline">Naar gebruikers <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
            </section>
          </div>
        </div>

        {/* KPI strip */}
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <OpsCard icon="users" label="Users" value={usersTotal} href="/admin/system/users" cta="Naar users" lines={[{ text: `${usersActive} actief` }]} />
          <OpsCard icon="alert-triangle" label="Errors" value={openErrors} href="/admin/system/errors" cta="Naar errors" lines={[{ text: "open" }, criticalOpen > 0 ? { text: `${criticalOpen} critical`, tone: "red" } : { text: "geen critical", tone: "muted" }]} />
          <OpsCard icon="list" label="Audit" value={auditCount24h} href="/admin/system/audit" cta="Naar audit" lines={[{ text: "events (24u)" }]} />
          <OpsCard icon="arrow-right" label="Webhooks" value={webhookFailures7d} href="/admin/system/webhooks" cta="Naar webhooks" lines={[{ text: "fouten (7d)" }, webhookFailures7d > 0 ? { text: "controleer", tone: "amber" } : { text: "ok", tone: "muted" }]} />
          <OpsCard icon="mail" label="E-mail" value={deliveredPct7 != null ? `${deliveredPct7}%` : "—"} href="/admin/system/emails" cta="Naar e-mail" lines={[{ text: "bezorgd (7d)" }, health.emailBouncesLast7d > 0 ? { text: `${health.emailBouncesLast7d} bounces`, tone: "amber" } : { text: "geen bounces", tone: "muted" }]} />
          <OpsCard icon="shield-check" label="Privacy" value={openPrivacyCount} href="/admin/system/privacy-requests" cta="Naar verzoeken" lines={[{ text: "open verzoeken" }, privacyOverdue > 0 ? { text: `${privacyOverdue} over tijd`, tone: "red" } : privacyDueSoon > 0 ? { text: `${privacyDueSoon} deze week`, tone: "amber" } : { text: "binnen SLA", tone: "muted" }]} />
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-200 pt-4 font-ui text-[11px] text-ink-500">
          <span className={`flex items-center gap-1.5 ${rm.text}`}><span className={`h-1.5 w-1.5 rounded-full ${rm.dot}`} /> {rm.label}</span>
          <span>Omgeving: {env.VERCEL_ENV}</span>
          {hasBackups && <span>Backup {fmtDate(latestBackup!.startedAt)} · {latestBackup!.status}</span>}
          {latestPayroll?.exportedAt && <span>Payroll-export {fmtDate(latestPayroll.exportedAt)}</span>}
          <Link href="/admin/business/integrations" className="ml-auto text-burgundy hover:underline">Alle integraties →</Link>
        </div>
      </div>
    </div>
  );
}

/* ----- helpers ----- */

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  error: "bg-burgundy/10 text-burgundy",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-bg-gray text-ink-700",
};

const TONE_ICON: Record<SystemTone, string> = {
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-blue-600",
  grey: "text-ink-500",
};

function VerbruikCard({
  icon, title, badge, value, unit, lines, href, linkLabel, concept, cost,
}: {
  icon: IconName;
  title: string;
  badge: { text: string; tone: "green" | "amber" | "grey" };
  value: string;
  unit: string;
  lines: string[];
  href?: string;
  linkLabel?: string;
  concept?: boolean;
  cost?: string;
}) {
  const badgeCls = badge.tone === "green" ? "bg-emerald-100 text-emerald-700" : badge.tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-bg-gray text-ink-500";
  return (
    <div className={`rounded-xl border p-5 ${concept ? "border-dashed border-ink-200 bg-bg-gray/40" : "border-ink-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-ui text-[11px] uppercase tracking-[0.16em] text-ink-500"><Icon name={icon} className="h-4 w-4" /> {title}</p>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badgeCls}`}>{badge.text}</span>
      </div>
      <p className={`mt-2 font-serif text-3xl ${concept ? "text-ink-500" : "text-ink-900"}`}>{value} <span className="text-lg text-ink-500">{unit}</span></p>
      <div className="mt-1 space-y-0.5 text-[11px] text-ink-500">
        {lines.map((l, i) => <p key={i}>{l}</p>)}
        <p className="flex items-center gap-1"><Icon name="banknote" className="h-3.5 w-3.5" /> Kosten: <span className="text-ink-700">{cost ?? "n.t.b."}</span></p>
      </div>
      {href && linkLabel && (
        <Link href={href} className="mt-3 flex items-center gap-1 font-ui text-[11px] font-medium text-burgundy hover:underline">{linkLabel} <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
      )}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
}
function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
