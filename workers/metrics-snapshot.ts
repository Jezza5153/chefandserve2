/**
 * metrics-snapshot — KPI-1. Per-day ACTIVITY snapshot worker.
 *
 * Railway cron 00:30 Amsterdam (after complete-placements has flipped the day's
 * shifts → completed and created draft hours). Writes one chef_metrics_daily +
 * one client_metrics_daily row per active entity per day.
 *
 * IDEMPOTENT: ON CONFLICT (entity, snapshot_date) DO UPDATE — re-running a date
 * refreshes its row, never duplicates. Each metric is keyed by its OWN natural
 * date so re-running always reproduces the same value and there is no late-arrival
 * miss:
 *   - hours + money  → shift_hours.admin_approved_at::date  (FINAL statuses only)
 *   - completed shifts → shifts.ends_at::date
 *   - ratings          → ratings.created_at::date
 *   - reliability      → chef_events.occurred_at::date
 * Because every column is an additive measure on its own day, any period = SUM over
 * a date range and any average = Σsum / Σcount (see src/lib/domain/metrics-history.ts).
 *
 * HONESTY (mirrors src/lib/domain/chef-history.ts): money + hours come ONLY from
 * FINAL shift_hours (admin_approved / exported) — never draft/submitted/rejected.
 *
 * Usage:
 *   npx tsx workers/metrics-snapshot.ts                 # default: yesterday (Amsterdam)
 *   npx tsx workers/metrics-snapshot.ts --date=2026-06-01
 *   npx tsx workers/metrics-snapshot.ts --backfill=180  # yesterday back N days (resumable)
 */
import { audit, log, sql } from "./_lib";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

/** Dates to process, most-recent first. Computed from the SQL clock (not Node's). */
async function resolveDates(): Promise<string[]> {
  const explicit = arg("date");
  if (explicit) {
    if (!DATE_RE.test(explicit)) throw new Error(`--date must be YYYY-MM-DD, got "${explicit}"`);
    return [explicit];
  }
  const backfill = Number(arg("backfill") || 0);
  const n = backfill > 0 ? Math.min(backfill, 1000) : 1;
  const rows = (await sql`
    SELECT (((now() AT TIME ZONE 'Europe/Amsterdam')::date - 1) - g.i)::text AS d
    FROM generate_series(0, ${n - 1}) AS g(i)
  `) as Array<{ d: string }>;
  return rows.map((r) => r.d);
}

async function snapshotChefs(d: string): Promise<number> {
  const res = (await sql`
    INSERT INTO chef_metrics_daily (
      chef_id, snapshot_date, hours_worked_minutes, pay_cents, revenue_cents, margin_cents,
      completed_shifts, rating_sum, rating_count,
      proposals_accepted, proposals_rejected, cancellations, hours_submitted,
      response_seconds_sum, response_seconds_count
    )
    SELECT ids.chef_id, ${d}::date,
      coalesce(h.mins,0), coalesce(h.pay,0), coalesce(h.rev,0), coalesce(h.rev,0) - coalesce(h.pay,0),
      coalesce(cs.n,0), coalesce(r.rsum,0), coalesce(r.rcount,0),
      coalesce(e.acc,0), coalesce(e.rej,0), coalesce(e.canc,0), coalesce(e.hsub,0),
      coalesce(e.rss,0), coalesce(e.rsc,0)
    FROM (
      SELECT chef_id FROM shift_hours WHERE status IN ('admin_approved','exported') AND admin_approved_at::date = ${d}::date
      UNION SELECT p.chef_id FROM placements p JOIN shifts s ON s.id = p.shift_id WHERE p.status = 'completed' AND s.ends_at::date = ${d}::date
      UNION SELECT chef_id FROM ratings WHERE created_at::date = ${d}::date AND chef_id IS NOT NULL
      UNION SELECT chef_id FROM chef_events WHERE occurred_at::date = ${d}::date
    ) ids
    LEFT JOIN (
      SELECT chef_id,
        sum(worked_minutes)::int AS mins,
        sum(round(worked_minutes / 60.0 * chef_rate_cents))::int AS pay,
        sum(round(worked_minutes / 60.0 * client_rate_cents))::int AS rev
      FROM shift_hours WHERE status IN ('admin_approved','exported') AND admin_approved_at::date = ${d}::date
      GROUP BY chef_id
    ) h ON h.chef_id = ids.chef_id
    LEFT JOIN (
      SELECT p.chef_id, count(*)::int AS n FROM placements p JOIN shifts s ON s.id = p.shift_id
      WHERE p.status = 'completed' AND s.ends_at::date = ${d}::date GROUP BY p.chef_id
    ) cs ON cs.chef_id = ids.chef_id
    LEFT JOIN (
      SELECT chef_id, sum(stars)::int AS rsum, count(*)::int AS rcount
      FROM ratings WHERE created_at::date = ${d}::date GROUP BY chef_id
    ) r ON r.chef_id = ids.chef_id
    LEFT JOIN (
      SELECT chef_id,
        count(*) FILTER (WHERE event_type = 'proposal_accepted')::int AS acc,
        count(*) FILTER (WHERE event_type = 'proposal_rejected')::int AS rej,
        count(*) FILTER (WHERE event_type = 'shift_cancelled_by_chef')::int AS canc,
        count(*) FILTER (WHERE event_type = 'hours_submitted')::int AS hsub,
        coalesce(sum(response_seconds) FILTER (WHERE event_type IN ('proposal_accepted','proposal_rejected')), 0)::int AS rss,
        count(response_seconds) FILTER (WHERE event_type IN ('proposal_accepted','proposal_rejected'))::int AS rsc
      FROM chef_events WHERE occurred_at::date = ${d}::date GROUP BY chef_id
    ) e ON e.chef_id = ids.chef_id
    ON CONFLICT (chef_id, snapshot_date) DO UPDATE SET
      hours_worked_minutes = excluded.hours_worked_minutes, pay_cents = excluded.pay_cents,
      revenue_cents = excluded.revenue_cents, margin_cents = excluded.margin_cents,
      completed_shifts = excluded.completed_shifts, rating_sum = excluded.rating_sum, rating_count = excluded.rating_count,
      proposals_accepted = excluded.proposals_accepted, proposals_rejected = excluded.proposals_rejected,
      cancellations = excluded.cancellations, hours_submitted = excluded.hours_submitted,
      response_seconds_sum = excluded.response_seconds_sum, response_seconds_count = excluded.response_seconds_count
    RETURNING chef_id
  `) as Array<{ chef_id: string }>;
  return res.length;
}

async function snapshotClients(d: string): Promise<number> {
  const res = (await sql`
    INSERT INTO client_metrics_daily (
      client_id, snapshot_date, shifts_count, slots_count, filled_slots,
      spend_cents, chef_pay_cents, margin_cents, rating_sum, rating_count,
      approval_sla_minutes_sum, approval_sla_count
    )
    SELECT ids.client_id, ${d}::date,
      coalesce(sh.shifts,0), coalesce(sh.slots,0), coalesce(fl.filled,0),
      coalesce(m.spend,0), coalesce(m.pay,0), coalesce(m.spend,0) - coalesce(m.pay,0),
      coalesce(r.rsum,0), coalesce(r.rcount,0),
      coalesce(sla.slamin,0), coalesce(sla.slacount,0)
    FROM (
      SELECT client_id FROM shifts WHERE starts_at::date = ${d}::date
      UNION SELECT client_id FROM shift_hours WHERE status IN ('admin_approved','exported') AND admin_approved_at::date = ${d}::date
      UNION SELECT client_id FROM ratings WHERE created_at::date = ${d}::date AND client_id IS NOT NULL
    ) ids
    LEFT JOIN (
      SELECT client_id, count(*)::int AS shifts, sum(headcount)::int AS slots
      FROM shifts WHERE starts_at::date = ${d}::date GROUP BY client_id
    ) sh ON sh.client_id = ids.client_id
    LEFT JOIN (
      SELECT s.client_id, count(*)::int AS filled
      FROM placements p JOIN shifts s ON s.id = p.shift_id
      WHERE s.starts_at::date = ${d}::date AND p.status IN ('confirmed','completed')
      GROUP BY s.client_id
    ) fl ON fl.client_id = ids.client_id
    LEFT JOIN (
      SELECT client_id,
        sum(round(worked_minutes / 60.0 * client_rate_cents))::int AS spend,
        sum(round(worked_minutes / 60.0 * chef_rate_cents))::int AS pay
      FROM shift_hours WHERE status IN ('admin_approved','exported') AND admin_approved_at::date = ${d}::date
      GROUP BY client_id
    ) m ON m.client_id = ids.client_id
    LEFT JOIN (
      SELECT client_id, sum(stars)::int AS rsum, count(*)::int AS rcount
      FROM ratings WHERE created_at::date = ${d}::date GROUP BY client_id
    ) r ON r.client_id = ids.client_id
    LEFT JOIN (
      SELECT client_id,
        coalesce(sum(extract(epoch FROM (admin_approved_at - client_signed_at)) / 60), 0)::int AS slamin,
        count(*)::int AS slacount
      FROM shift_hours
      WHERE status IN ('admin_approved','exported') AND admin_approved_at::date = ${d}::date AND client_signed_at IS NOT NULL
      GROUP BY client_id
    ) sla ON sla.client_id = ids.client_id
    ON CONFLICT (client_id, snapshot_date) DO UPDATE SET
      shifts_count = excluded.shifts_count, slots_count = excluded.slots_count, filled_slots = excluded.filled_slots,
      spend_cents = excluded.spend_cents, chef_pay_cents = excluded.chef_pay_cents, margin_cents = excluded.margin_cents,
      rating_sum = excluded.rating_sum, rating_count = excluded.rating_count,
      approval_sla_minutes_sum = excluded.approval_sla_minutes_sum, approval_sla_count = excluded.approval_sla_count
    RETURNING client_id
  `) as Array<{ client_id: string }>;
  return res.length;
}

async function main() {
  const dates = await resolveDates();
  log(`metrics-snapshot: ${dates.length} date(s): ${dates[dates.length - 1]} … ${dates[0]}`);
  let chefRows = 0;
  let clientRows = 0;
  for (const d of dates) {
    const c = await snapshotChefs(d);
    const cl = await snapshotClients(d);
    chefRows += c;
    clientRows += cl;
    log(`  ${d}: ${c} chef row(s), ${cl} client row(s)`);
  }
  await audit("metrics_snapshot.run", "metrics", null, { dates: dates.length, chefRows, clientRows });
  log("metrics-snapshot: done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[metrics-snapshot] FAILED:", err);
    process.exit(1);
  });
