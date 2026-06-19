/**
 * complete-placements worker — PR-CHEF-1.
 *
 * Runs every 30 minutes on Railway. Two responsibilities:
 *
 *   1. Flip placements.status from 'confirmed' → 'completed' when the shift
 *      end time + 1 hour buffer has passed. (1-hour buffer accommodates
 *      shifts that run slightly late; admin can still manually correct via
 *      the placement page if a chef no-shows or the shift is cancelled.)
 *
 *   2. For each newly-completed placement, INSERT a draft shift_hours row.
 *      Idempotent — `shift_hours.placementId` is UNIQUE, so re-running the
 *      worker never duplicates rows.
 *
 * The chef's "Uren in te dienen" card on /chef appears the next time they
 * load the dashboard, sourced from this row. CHEF-PR4 clock-out recovery: when
 * CLOCK_OUT_RECOVERY_ENABLED=true, the chef ALSO gets an immediate in-app prompt
 * to submit (instead of waiting for hours-reminders' first +24h nudge).
 *
 * Run manually: `tsx workers/complete-placements.ts`
 */

import { audit, log, sql } from "./_lib";

async function main() {
  const startedAt = new Date();
  log("complete-placements: starting");

  // ----- Step 1: flip confirmed → completed -----
  // SHIFT endsAt > 1 hour ago. We use the SQL clock, not Node's, for
  // determinism across timezones / clock skew.
  const flipped = await sql`
    WITH targets AS (
      SELECT p.id AS placement_id, s.id AS shift_id
      FROM placements p
      INNER JOIN shifts s ON s.id = p.shift_id
      WHERE p.status = 'confirmed'
        AND s.ends_at < now() - interval '1 hour'
      FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE placements
    SET status = 'completed', completed_at = now(), updated_at = now()
    FROM targets
    WHERE placements.id = targets.placement_id
    RETURNING placements.id AS placement_id, placements.chef_id, placements.shift_id
  ` as Array<{ placement_id: string; chef_id: string; shift_id: string }>;

  log(`flipped ${flipped.length} placements to completed`);

  // ----- Step 2: create draft shift_hours rows -----
  let createdRows = 0;
  for (const p of flipped) {
    // Load denormalized fields (client, rates, scheduled times).
    const [info] = (await sql`
      SELECT
        s.id           AS shift_id,
        s.client_id    AS client_id,
        s.starts_at    AS scheduled_start,
        s.ends_at      AS scheduled_end,
        s.chef_rate_cents AS shift_chef_rate,
        s.client_rate_cents AS shift_client_rate,
        pl.chef_rate_cents AS placement_chef_rate,
        c.company_name AS company_name,
        ch.user_id     AS chef_user_id
      FROM shifts s
      INNER JOIN placements pl ON pl.id = ${p.placement_id}
      LEFT JOIN clients c ON c.id = s.client_id
      LEFT JOIN chefs ch ON ch.id = pl.chef_id
      WHERE s.id = ${p.shift_id}
    `) as Array<{
      shift_id: string;
      client_id: string;
      scheduled_start: Date;
      scheduled_end: Date;
      shift_chef_rate: number | null;
      shift_client_rate: number | null;
      placement_chef_rate: number | null;
      company_name: string | null;
      chef_user_id: string | null;
    }>;

    if (!info) continue;

    const chefRate = info.placement_chef_rate ?? info.shift_chef_rate ?? 0;
    const clientRate = info.shift_client_rate ?? 0;
    const start = new Date(info.scheduled_start);
    const end = new Date(info.scheduled_end);
    const scheduledMinutes = Math.max(
      0,
      Math.floor((end.getTime() - start.getTime()) / 60000),
    );

    // ON CONFLICT DO NOTHING: idempotent — re-running the worker after
    // partial failure won't create duplicates. The placementId UNIQUE
    // constraint guards against double inserts.
    const inserted = await sql`
      INSERT INTO shift_hours (
        placement_id, shift_id, chef_id, client_id,
        started_at, ended_at, break_minutes, worked_minutes,
        chef_rate_cents, client_rate_cents,
        status
      ) VALUES (
        ${p.placement_id}, ${p.shift_id}, ${p.chef_id}, ${info.client_id},
        ${info.scheduled_start}, ${info.scheduled_end}, 0, ${scheduledMinutes},
        ${chefRate}, ${clientRate},
        'draft'
      )
      ON CONFLICT (placement_id) DO NOTHING
      RETURNING id
    `;
    if ((inserted as Array<{ id: string }>).length > 0) {
      createdRows++;
      const hoursId = (inserted as Array<{ id: string }>)[0].id;
      await audit("shift_hours.draft_created", "shift_hours", hoursId, {
        placementId: p.placement_id,
        chefId: p.chef_id,
        via: "worker",
      });

      // CHEF-PR4 clock-out recovery: the draft (the "provisional clock-out") now
      // exists, so prompt the chef to submit their hours RIGHT AWAY — instead of
      // only on next dashboard load, with hours-reminders' first nudge 24h later.
      // Fires once (only on a freshly-created draft). In-app; dark-launched.
      if (process.env.CLOCK_OUT_RECOVERY_ENABLED === "true" && info.chef_user_id) {
        const where = info.company_name ?? "een klant";
        await sql`
          INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
          VALUES (
            ${info.chef_user_id}, 'hours_ready_to_submit',
            'Je shift is afgerond — dien je uren in',
            ${`${where}: vul je gewerkte uren in zodat ze getekend en uitbetaald kunnen worden.`},
            ${`/chef/hours/${p.placement_id}`}, 'shift_hours', ${hoursId}
          )
        `.catch((e) => log(`clock-out-recovery: notify failed (${p.placement_id}): ${String(e)}`));
      }
    }
  }

  // ----- Step 3: advance the parent SHIFT to 'completed' -----
  // The shift backbone follows its placements (mirrors
  // src/lib/domain/shift-status.ts rule 2 — kept inline because the worker
  // can't import src/lib). A shift is completed when it has ended AND it has at
  // least one non-cancelled placement AND every non-cancelled placement is
  // 'completed'. Scoped to the shifts we just touched this run, and never
  // resurrects a 'cancelled' shift.
  const shiftIds = Array.from(new Set(flipped.map((p) => p.shift_id)));
  let completedShifts = 0;
  if (shiftIds.length > 0) {
    const updatedShifts = await sql`
      UPDATE shifts s
      SET status = 'completed', updated_at = now()
      WHERE s.id = ANY(${shiftIds})
        AND s.status NOT IN ('completed', 'cancelled')
        AND s.ends_at <= now()
        AND EXISTS (
          SELECT 1 FROM placements p
          WHERE p.shift_id = s.id AND p.status NOT IN ('cancelled', 'draft')
        )
        AND NOT EXISTS (
          SELECT 1 FROM placements p
          WHERE p.shift_id = s.id
            AND p.status NOT IN ('cancelled', 'draft', 'completed')
        )
      RETURNING s.id
    ` as Array<{ id: string }>;
    completedShifts = updatedShifts.length;
    for (const s of updatedShifts) {
      await audit("shift.completed", "shifts", s.id, { via: "worker" });
    }
  }

  log(
    `created ${createdRows} draft shift_hours rows, completed ${completedShifts} shifts (took ${
      Date.now() - startedAt.getTime()
    }ms)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[complete-placements] FAILED:", err);
    process.exit(1);
  });
