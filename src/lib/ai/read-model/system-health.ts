/**
 * System-health read-model — gives the assistant eyes on the platform itself (audit: the
 * error-digest and metrics-snapshot workers produced data the AI could not read). Counts +
 * truncated top error messages only — never stack traces or context blobs (they can contain
 * request data), and resolved errors are reported as resolved.
 */
import { desc, gt, isNull, max, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefMetricsDaily, errorLog } from "@/lib/db/schema";

const MSG_CAP = 140;

export type SystemHealth = {
  windowHours: number;
  errorsTotal: number;
  errorsUnresolved: number;
  topErrors: { message: string; severity: string; count: number }[];
  /** Latest nightly metrics-snapshot date (null = snapshot worker never ran). */
  lastMetricsSnapshot: string | null;
};

export async function getSystemHealth(args: { now: Date; windowHours?: number }): Promise<SystemHealth> {
  const windowHours = args.windowHours ?? 24;
  const since = new Date(args.now.getTime() - windowHours * 3_600_000);

  const [rows, unresolved, snapshot] = await Promise.all([
    db
      .select({
        message: errorLog.message,
        severity: errorLog.severity,
        count: sql<number>`count(*)`,
      })
      .from(errorLog)
      .where(gt(errorLog.createdAt, since))
      .groupBy(errorLog.message, errorLog.severity)
      .orderBy(desc(sql`count(*)`))
      .limit(3),
    db
      .select({ count: sql<number>`count(*)` })
      .from(errorLog)
      .where(sql`${errorLog.createdAt} > ${since} AND ${errorLog.resolvedAt} IS NULL`),
    db.select({ last: max(chefMetricsDaily.snapshotDate) }).from(chefMetricsDaily),
  ]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // total above only covers the top-3 groups; get the real total cheaply:
  const [all] = await db
    .select({ count: sql<number>`count(*)` })
    .from(errorLog)
    .where(gt(errorLog.createdAt, since));

  return {
    windowHours,
    errorsTotal: Number(all?.count ?? total),
    errorsUnresolved: Number(unresolved[0]?.count ?? 0),
    topErrors: rows.map((r) => ({
      message: (r.message ?? "").slice(0, MSG_CAP),
      severity: r.severity ?? "error",
      count: Number(r.count),
    })),
    lastMetricsSnapshot: snapshot[0]?.last ?? null,
  };
}
