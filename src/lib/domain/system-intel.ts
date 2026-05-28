/**
 * System cockpit intelligence — Phase A (read-only). Pure + deterministic.
 *
 * Ranks the super-admin "Aandacht nodig" queue so the worst platform problem
 * surfaces first, and rolls the signals into one overall health label. No DB,
 * no React — testable. AI usage is a dashboard card, NEVER an urgent item.
 */

import type { IconName } from "@/components/admin/icons";

export type SystemAttentionKind =
  | "critical_error" // 1 — unresolved critical/error in error_log
  | "failed_outbox" // 2 — integration_outbox failed
  | "privacy_overdue" // 3 — privacy_requests past dueDate
  | "backup_failed" // 4 — last backup failed / stale
  | "health_failing" // 5 — a /api/health component down
  | "email_bounce_spike" // 6 — bounces over threshold (7d)
  | "webhook_failure" // 7 — webhooks_received.processing_error
  | "privacy_due_soon"; // 8 — privacy due within 7 days

export type SystemTone = "red" | "amber" | "blue" | "grey";

export type SystemAttentionItem = {
  kind: SystemAttentionKind;
  tone: SystemTone;
  icon: IconName;
  title: string;
  detail?: string;
  href: string;
  cta?: string;
};

/** Lower = more urgent (rendered first). */
const PRIORITY: Record<SystemAttentionKind, number> = {
  critical_error: 1,
  failed_outbox: 2,
  privacy_overdue: 3,
  backup_failed: 4,
  health_failing: 5,
  email_bounce_spike: 6,
  webhook_failure: 7,
  privacy_due_soon: 8,
};

/**
 * Deterministic priority sort. `Array.sort` is stable, so items of equal kind
 * keep insertion order. AI/usage never appears here — it is informational only.
 */
export function rankSystemItems(items: SystemAttentionItem[]): SystemAttentionItem[] {
  return [...items].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/* ----- overall health rollup ---------------------------------------------- */

export type SystemHealth = "operationeel" | "aandacht" | "kritiek";

export type HealthSignals = {
  criticalErrors: number; // unresolved critical errors
  healthDown: boolean; // any /api/health component not ok
  backupFailedOrStale: boolean;
  outboxFailed: number;
  webhookFailures: number;
  privacyOverdue: number;
};

/**
 * One label for the page header / footer dot.
 * kritiek = something is broken now (critical errors · core health down · backup gone).
 * aandacht = degraded but not down (failed outbox/webhooks · overdue privacy SLA).
 * operationeel = nothing flagged.
 */
export function systemHealthRollup(s: HealthSignals): SystemHealth {
  if (s.criticalErrors > 0 || s.healthDown || s.backupFailedOrStale) return "kritiek";
  if (s.outboxFailed > 0 || s.webhookFailures > 0 || s.privacyOverdue > 0) return "aandacht";
  return "operationeel";
}
