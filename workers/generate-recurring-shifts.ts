/**
 * generate-recurring-shifts worker — PR-KLANT-4.
 *
 * Runs daily on Railway. For each active shift_template, materializes real
 * `shifts` rows over a rolling horizon [today, today + generate_horizon_days]
 * on the template's day_of_week, skipping any shift_template_exceptions dates.
 *
 * OVERNIGHT SHIFTS (correction round 3, #1): horeca shifts cross midnight
 * (17:00–01:00). When `ends_next_day` is true — OR end time <= start time —
 * endsAt lands on the NEXT calendar day. All wall-clock → instant conversion
 * happens in Postgres via `AT TIME ZONE 'Europe/Amsterdam'`, so DST
 * boundaries are handled correctly (never naive UTC arithmetic).
 *
 * LOCATION SNAPSHOT (correction #2): copies clients.shift_address/city into
 * the generated shift at creation. Later edits to the client's address never
 * rewrite already-generated shifts.
 *
 * IDEMPOTENT: ON CONFLICT (source_template_id, source_template_date) DO
 * NOTHING — re-running never duplicates. Editing a template does NOT touch
 * shifts already generated (they are independent).
 *
 * day_of_week uses Postgres DOW: 0=Sunday … 6=Saturday.
 *
 * Run manually: `tsx workers/generate-recurring-shifts.ts`
 */

import { audit, log, sql } from "./_lib";

type TemplateRow = {
  id: string;
  client_id: string;
  role_needed: string;
  segment: string | null;
  day_of_week: number;
  starts_at_time: string;
  ends_at_time: string;
  ends_next_day: boolean;
  headcount: number;
  chef_rate_cents: number | null;
  client_rate_cents: number | null;
  generate_horizon_days: number;
  shift_address: string | null;
  city: string | null;
};

async function main() {
  const startedAt = new Date();
  log("generate-recurring-shifts: starting");

  // Active templates not generated in the last 6h (cheap re-run guard).
  const templates = (await sql`
    SELECT
      t.id, t.client_id, t.role_needed, t.segment, t.day_of_week,
      t.starts_at_time, t.ends_at_time, t.ends_next_day, t.headcount,
      t.chef_rate_cents, t.client_rate_cents, t.generate_horizon_days,
      c.shift_address, c.city
    FROM shift_templates t
    INNER JOIN clients c ON c.id = t.client_id
    WHERE t.active = true
      AND (t.last_generated_at IS NULL OR t.last_generated_at < now() - interval '6 hours')
  `) as TemplateRow[];

  log(`found ${templates.length} active templates due for generation`);

  let totalCreated = 0;
  for (const t of templates) {
    // Next-day flag: explicit toggle OR end <= start (belt-and-suspenders).
    const nextDayExpr = t.ends_next_day;

    const inserted = (await sql`
      INSERT INTO shifts (
        id, client_id, starts_at, ends_at, role_needed, segment, headcount,
        location, city, client_rate_cents, chef_rate_cents, status,
        source_template_id, source_template_date, created_at, updated_at
      )
      SELECT
        gen_random_uuid()::text,
        ${t.client_id},
        ((g.d::date + ${t.starts_at_time}::time) AT TIME ZONE 'Europe/Amsterdam'),
        (
          (
            g.d::date
            + (CASE WHEN ${nextDayExpr} OR ${t.ends_at_time}::time <= ${t.starts_at_time}::time THEN 1 ELSE 0 END)
            + ${t.ends_at_time}::time
          ) AT TIME ZONE 'Europe/Amsterdam'
        ),
        ${t.role_needed}::vakniveau,
        ${t.segment}::segment,
        ${t.headcount},
        ${t.shift_address},
        ${t.city},
        ${t.client_rate_cents},
        ${t.chef_rate_cents},
        'open',
        ${t.id},
        g.d::date,
        now(), now()
      FROM generate_series(
        CURRENT_DATE::timestamp,
        (CURRENT_DATE + ${t.generate_horizon_days})::timestamp,
        interval '1 day'
      ) AS g(d)
      WHERE EXTRACT(DOW FROM g.d) = ${t.day_of_week}
        AND g.d::date NOT IN (
          SELECT date FROM shift_template_exceptions WHERE template_id = ${t.id}
        )
      ON CONFLICT (source_template_id, source_template_date)
        WHERE source_template_id IS NOT NULL DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;

    await sql`
      UPDATE shift_templates SET last_generated_at = now(), updated_at = now()
      WHERE id = ${t.id}
    `;

    if (inserted.length > 0) {
      totalCreated += inserted.length;
      await audit("shift_templates.generated", "shift_templates", t.id, {
        created: inserted.length,
        horizonDays: t.generate_horizon_days,
        dayOfWeek: t.day_of_week,
      });
      log(`template ${t.id}: created ${inserted.length} shifts`);
    }
  }

  log(
    `done — created ${totalCreated} shifts across ${templates.length} templates (took ${
      Date.now() - startedAt.getTime()
    }ms)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[generate-recurring-shifts] FAILED:", err);
    process.exit(1);
  });
