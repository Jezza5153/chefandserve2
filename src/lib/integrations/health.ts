/**
 * Integration health summary — PR-CHEF-0.
 *
 * Powers the "Systeem / integraties" card on /admin/business and the
 * /admin/business/integrations control room. Single query bundle, cached
 * 60s in-memory (matches the routeFor() pattern in notifications.ts).
 */

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  emailMessages,
  integrationOutbox,
  integrationRuns,
} from "@/lib/db/schema";

export type HealthSummary = {
  outboxPending: number;
  outboxFailed: number;
  emailBouncesLast7d: number;
  emailDeliveredLast7d: number;
  lastBackupAt: Date | null; // null until PR-CHEF-13 lands
  lastRunPerProvider: Array<{
    provider: string;
    status: string;
    finishedAt: Date | null;
  }>;
  cachedAt: number;
};

let cache: HealthSummary | null = null;
const TTL_MS = 60 * 1000;

export async function getIntegrationHealth(): Promise<HealthSummary> {
  const now = Date.now();
  if (cache && now - cache.cachedAt < TTL_MS) return cache;

  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // Outbox counts
  const outboxCountsResult = await db.execute(sql`
    SELECT status, count(*)::int AS n
    FROM integration_outbox
    GROUP BY status
  `);
  const outboxRows = Array.isArray(outboxCountsResult)
    ? outboxCountsResult
    : ((outboxCountsResult as unknown as { rows?: unknown[] }).rows ?? []);
  let outboxPending = 0;
  let outboxFailed = 0;
  for (const r of outboxRows as Array<{ status: string; n: number }>) {
    if (r.status === "pending" || r.status === "processing") outboxPending += r.n;
    if (r.status === "failed") outboxFailed += r.n;
  }

  // Email counts last 7 days
  const emailCountsResult = await db.execute(sql`
    SELECT status, count(*)::int AS n
    FROM email_messages
    WHERE created_at > ${since7d.toISOString()}
    GROUP BY status
  `);
  const emailRows = Array.isArray(emailCountsResult)
    ? emailCountsResult
    : ((emailCountsResult as unknown as { rows?: unknown[] }).rows ?? []);
  let emailBouncesLast7d = 0;
  let emailDeliveredLast7d = 0;
  for (const r of emailRows as Array<{ status: string; n: number }>) {
    if (r.status === "bounced") emailBouncesLast7d += r.n;
    if (r.status === "delivered") emailDeliveredLast7d += r.n;
  }

  // Last run per provider — uses DISTINCT ON for "latest per group".
  const lastRunsResult = await db.execute(sql`
    SELECT DISTINCT ON (provider)
      provider, status, finished_at
    FROM integration_runs
    ORDER BY provider, finished_at DESC NULLS LAST
  `);
  const lastRuns = (
    Array.isArray(lastRunsResult)
      ? lastRunsResult
      : ((lastRunsResult as unknown as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ provider: string; status: string; finished_at: Date | null }>;

  cache = {
    outboxPending,
    outboxFailed,
    emailBouncesLast7d,
    emailDeliveredLast7d,
    lastBackupAt: null, // PR-CHEF-13 will populate from backup_runs
    lastRunPerProvider: lastRuns.map((r) => ({
      provider: r.provider,
      status: r.status,
      finishedAt: r.finished_at,
    })),
    cachedAt: now,
  };
  return cache;
}

/** Force cache invalidation — called from the retry button. */
export function invalidateHealthCache(): void {
  cache = null;
}

/** Outbox pending rows for the admin retry table. */
export async function listPendingOutbox(limit: number = 100) {
  return db
    .select()
    .from(integrationOutbox)
    .where(
      sql`${integrationOutbox.status} IN ('pending','processing','failed')`,
    )
    .orderBy(integrationOutbox.nextAttemptAt)
    .limit(limit);
}

/** Recent runs for the admin runs table. */
export async function listRecentRuns(limit: number = 50) {
  return db
    .select()
    .from(integrationRuns)
    .orderBy(sql`${integrationRuns.startedAt} DESC NULLS LAST`)
    .limit(limit);
}

/** Recent email bounces for the email-health card. */
export async function listRecentBounces(limit: number = 20) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(emailMessages)
    .where(
      and(eq(emailMessages.status, "bounced"), gt(emailMessages.createdAt, since)),
    )
    .orderBy(sql`${emailMessages.createdAt} DESC`)
    .limit(limit);
}
