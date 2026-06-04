/**
 * deliver-outbox worker — PR-AUDIT-5.
 *
 * Drains the integration_outbox. Until the Payingit / accounting / calendar
 * integrations land (Phase 5+), the only provider we can actually deliver is
 * `internal` — rows whose user-facing side effects (email + notification)
 * ALREADY fired inline at enqueue time. Those rows are idempotent breadcrumbs
 * for future internal consumers (analytics, the AI corpus); "delivering" one
 * just means acknowledging it: status pending → sent.
 *
 * External providers (`payroll`, `csv`, …) have NO delivery handler yet. We
 * deliberately LEAVE them pending — that's an honest "awaiting integration"
 * backlog, already surfaced as `outboxPending` on /admin/business/integrations.
 * They are NOT marked failed: nothing is wrong, the delivery seam isn't built.
 *
 * A batch that actually delivers something writes ONE integration_runs row
 * (run_type 'cron') so the integrations-health "last run per provider" panel
 * reflects reality; delivered rows get their run_id back-stamped for forensics.
 * We never write an empty run row, so the table doesn't bloat on idle ticks.
 *
 * Idempotent + safe to re-run: the claim is a single atomic UPDATE guarded by
 * status='pending' + FOR UPDATE SKIP LOCKED, so overlapping ticks can never
 * double-deliver a row, and a crash can never strand one in 'processing'.
 *
 * Run: `npx tsx workers/deliver-outbox.ts`
 */

import { audit, log, sql } from "./_lib";

const BATCH_LIMIT = 200;

async function deliverInternal(): Promise<{ delivered: number }> {
  // Cheap pre-check so idle ticks never insert an empty run row.
  const [due] = (await sql`
    SELECT count(*)::int AS n
    FROM integration_outbox
    WHERE provider = 'internal'
      AND status = 'pending'
      AND next_attempt_at <= now()
  `) as Array<{ n: number }>;
  if (!due || due.n === 0) {
    log("deliver-outbox: internal — 0 due");
    return { delivered: 0 };
  }

  // Open the run first so we can stamp run_id inside the claim itself.
  const [run] = (await sql`
    INSERT INTO integration_runs (provider, run_type, status, started_at)
    VALUES ('internal', 'cron', 'running', now())
    RETURNING id
  `) as Array<{ id: string }>;

  // Claim + acknowledge in ONE atomic statement — `internal` delivery has no
  // external call, so ack == delivered. SKIP LOCKED keeps overlapping ticks
  // from contending; the WHERE status='pending' guard makes it re-run-safe.
  const claimed = (await sql`
    WITH due AS (
      SELECT id FROM integration_outbox
      WHERE provider = 'internal'
        AND status = 'pending'
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT ${BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE integration_outbox o
    SET status = 'sent', sent_at = now(), run_id = ${run.id}
    FROM due
    WHERE o.id = due.id
    RETURNING o.id
  `) as Array<{ id: string }>;

  const delivered = claimed.length;
  await sql`
    UPDATE integration_runs
    SET status = 'success', finished_at = now(),
        total_items = ${delivered}, success_count = ${delivered}, failed_count = 0,
        notes = 'deliver-outbox: internal breadcrumbs acked'
    WHERE id = ${run.id}
  `;

  await audit("integration.outbox_delivered", "integration_runs", run.id, {
    provider: "internal",
    delivered,
  });
  log(`deliver-outbox: internal — delivered ${delivered} (run ${run.id})`);
  return { delivered };
}

/** Log the still-pending external backlog. No state change — no handler yet. */
async function reportDeferred(): Promise<void> {
  const rows = (await sql`
    SELECT provider, count(*)::int AS n
    FROM integration_outbox
    WHERE status = 'pending'
      AND next_attempt_at <= now()
      AND provider <> 'internal'
    GROUP BY provider
    ORDER BY provider
  `) as Array<{ provider: string; n: number }>;
  for (const r of rows) {
    log(
      `deliver-outbox: ${r.provider} — ${r.n} pending, deferred ` +
        `(no delivery handler yet; awaiting integration)`,
    );
  }
}

async function main() {
  log("deliver-outbox: starting");
  const { delivered } = await deliverInternal();
  await reportDeferred();
  log(`deliver-outbox: done — ${delivered} delivered`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[deliver-outbox] FAILED:", err);
    process.exit(1);
  });
