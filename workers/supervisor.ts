/**
 * Supervisor — runs all workers on their cron schedules in one process.
 *
 * Why one process: each worker runs for seconds per day, so a single
 * always-on Railway service ($5/mo) is cheaper and simpler than 4 services
 * with per-service Railway cron config (which requires dashboard clicks).
 *
 * The supervisor stays alive between firings; each fired job spawns a
 * fresh `tsx` subprocess so its lifecycle (env, DB connections, exit code)
 * is fully isolated. If a job crashes, the supervisor logs it and keeps
 * running.
 *
 * Schedules:
 *   - weekly-digest            0 8 * * MON   (Mon 08:00 — Maarten's weekly view)
 *   - error-digest             0 7 * * *     (07:00 daily — no email if 0 errors)
 *   - embedding-refresh        0 3 * * *     (03:00 daily — OBSERVE mode without OPENAI_API_KEY)
 *   - payingit-sync            0 17 * * FRI  (Fri 17:00 — DRY-RUN until Phase 5)
 *   - generate-recurring-shifts 0 4 * * *    (04:00 daily — materialize template shifts)
 *   - complete-placements      every 30 min  (hours trust chain — confirmed→completed + draft hours)
 *   - metrics-snapshot         30 0 * * *     (00:30 daily — per-day KPI snapshot, idempotent)
 *   - document-expiry          0 6 * * *     (06:00 daily — chef-document expiry warnings)
 *   - retention                0 2 * * 0     (Sun 02:00 — storage-limitation purge; DOUBLE-GATED, no-op by default)
 *
 * Times in Europe/Amsterdam.
 *
 *   - deliver-outbox           every 5 min   (drain integration_outbox: ack internal breadcrumbs, defer external)
 *   - hours-reminders          0 9 * * *     (09:00 — chef 24/72h nudge, klant 5d timeout, admin 10d force-approve)
 *   - availability-reminder    0 9 * * THU   (Thu 09:00 — nudge active chefs for next-week availability; GATED off by default)
 *
 * Manual run for testing:
 *   npx tsx supervisor.ts --run-now=weekly-digest
 */

import { spawn } from "node:child_process";
import cron from "node-cron";

import { logError } from "./_lib";

const TIMEZONE = "Europe/Amsterdam";

type Job = {
  name: string;
  schedule: string;
  script: string;
};

const JOBS: Job[] = [
  { name: "weekly-digest", schedule: "0 8 * * 1", script: "weekly-digest.ts" },
  { name: "error-digest", schedule: "0 7 * * *", script: "error-digest.ts" },
  { name: "embedding-refresh", schedule: "0 3 * * *", script: "embedding-refresh.ts" },
  { name: "payingit-sync", schedule: "0 17 * * 5", script: "payingit-sync.ts" },
  // PR-KLANT-4: materialize recurring-template shifts daily (04:00 Amsterdam).
  { name: "generate-recurring-shifts", schedule: "0 4 * * *", script: "generate-recurring-shifts.ts" },
  // PR-CHEF-1: the hours trust chain. Flip confirmed→completed (endsAt+1h) +
  // create draft shift_hours. Idempotent — runs every 30 min.
  { name: "complete-placements", schedule: "*/30 * * * *", script: "complete-placements.ts" },
  // KPI-1: per-day metrics snapshot (00:30 Amsterdam, after complete-placements has
  // flipped the day's shifts → completed). Idempotent ON CONFLICT — safe to re-run.
  { name: "metrics-snapshot", schedule: "30 0 * * *", script: "metrics-snapshot.ts" },
  // PR-CHEF-12: daily chef-document expiry warnings (06:00 Amsterdam).
  { name: "document-expiry", schedule: "0 6 * * *", script: "document-expiry.ts" },
  // PR-REM-1: configurable reminder-rules engine (06:30 Amsterdam, after
  // document-expiry). Dark-launched via REMINDERS_ENABLED (default off → no-op).
  { name: "reminders", schedule: "30 6 * * *", script: "reminders.ts" },
  // PR-AVG-3: storage-limitation purge (Sun 02:00 Amsterdam). DOUBLE-GATED —
  // RETENTION_ENABLED + RETENTION_DRY_RUN both default safe, so this is a
  // no-op ("disabled") until a human deliberately flips both flags.
  { name: "retention", schedule: "0 2 * * 0", script: "retention.ts" },
  // PR-AUDIT-5: drain the integration_outbox every 5 min. Acks `internal`
  // breadcrumbs (status pending→sent); leaves external providers pending until
  // their delivery handler exists. Writes an integration_runs row on real work.
  { name: "deliver-outbox", schedule: "*/5 * * * *", script: "deliver-outbox.ts" },
  // PR-AUDIT-6: hours-chain reminders (09:00 Amsterdam). Chef 24/72h unanswered
  // proposals, klant 5-day unsigned timeout, admin 10-day force-approve. Each
  // tier is idempotent (last_*_reminder_at markers) so it never double-sends.
  { name: "hours-reminders", schedule: "0 9 * * *", script: "hours-reminders.ts" },
  // Weekly availability nudge (Thu 09:00 Amsterdam). Reminds active, portal-enabled
  // chefs to set next-week availability. GATED via business_settings
  // 'availability_reminders' (+ AVAILABILITY_REMINDERS_ENABLED kill-switch). Default OFF.
  { name: "availability-reminder", schedule: "0 9 * * 4", script: "availability-reminder.ts" },
  // Owner "dagstart" ticker — runs HOURLY and only fires at the owner's chosen hour
  // (business_settings 'daily_briefing'.hour, Amsterdam). Thin: it POSTs the app-side
  // /api/cron/daily-briefing which builds + delivers (idempotent). Default OFF.
  { name: "daily-briefing", schedule: "0 * * * *", script: "daily-briefing.ts" },
  // Proactive onboarding chase (Mon 09:00 Amsterdam). Thin: POSTs the app-side
  // /api/cron/onboarding-nudge which sweeps incomplete chef + client onboarding,
  // nudges each in-app (missing labels only — no PII) + summarises for Maarten.
  // Per-user throttled (6 days). GATED via ONBOARDING_NUDGE_ENABLED. Default OFF.
  { name: "onboarding-nudge", schedule: "0 9 * * 1", script: "onboarding-nudge.ts" },
];

function ts(): string {
  return new Date().toISOString();
}

/**
 * Record a crashed/failed worker run to error_log so it surfaces in the daily
 * error-digest (workers/error-digest.ts) and the /admin/system/errors board.
 * Best-effort: a logging failure must never crash the supervisor — we swallow
 * it (after a stderr note) so the job promise still resolves.
 */
async function recordJobFailure(
  job: Job,
  exitCode: number,
  reason: "exit" | "spawn",
): Promise<void> {
  const message = `worker ${job.name} exited ${exitCode}`;
  try {
    await logError({
      message,
      // Non-zero exit is operationally a warning; a spawn failure (worker never
      // ran) is a harder error worth flagging as such.
      severity: reason === "spawn" ? "error" : "warning",
      context: {
        source: "worker",
        job: job.name,
        script: job.script,
        exitCode,
        reason,
      },
    });
  } catch (err) {
    console.error(
      `[${ts()}] [supervisor] failed to write error_log for ${job.name}:`,
      err,
    );
  }
}

function runJob(job: Job): Promise<number> {
  return new Promise((resolve) => {
    console.log(`[${ts()}] [supervisor] starting ${job.name}`);
    const child = spawn("npx", ["tsx", job.script], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      console.log(
        `[${ts()}] [supervisor] ${job.name} exited code=${code ?? "null"}`,
      );
      // Observability: a non-zero exit now leaves an error_log row, not just a
      // stdout line. Resolve only after the write settles (best-effort).
      if (exitCode !== 0) {
        void recordJobFailure(job, exitCode, "exit").finally(() => resolve(exitCode));
      } else {
        resolve(exitCode);
      }
    });
    child.on("error", (err) => {
      console.error(`[${ts()}] [supervisor] ${job.name} spawn error:`, err);
      void recordJobFailure(job, 1, "spawn").finally(() => resolve(1));
    });
  });
}

/* ----- one-shot manual run ------------------------------------------- */

const RUN_NOW = process.argv
  .find((a) => a.startsWith("--run-now="))
  ?.split("=")[1];

if (RUN_NOW) {
  const job = JOBS.find((j) => j.name === RUN_NOW);
  if (!job) {
    console.error(`Unknown job '${RUN_NOW}'. Known: ${JOBS.map((j) => j.name).join(", ")}`);
    process.exit(1);
  }
  runJob(job).then((code) => process.exit(code));
} else {
  /* ----- scheduled mode -------------------------------------------- */
  console.log(`[${ts()}] [supervisor] starting in ${TIMEZONE}`);
  for (const job of JOBS) {
    cron.schedule(job.schedule, () => void runJob(job), {
      timezone: TIMEZONE,
    });
    console.log(`  scheduled ${job.name.padEnd(20)} '${job.schedule}'`);
  }

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[${ts()}] [supervisor] received ${signal}, exiting`);
      process.exit(0);
    });
  }

  // Heartbeat every hour so we know it's alive in Railway logs
  setInterval(
    () => console.log(`[${ts()}] [supervisor] heartbeat — ${JOBS.length} jobs scheduled`),
    60 * 60 * 1000,
  );
}
