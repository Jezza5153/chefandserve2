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
 *   - document-expiry          0 6 * * *     (06:00 daily — chef-document expiry warnings)
 *   - retention                0 2 * * 0     (Sun 02:00 — storage-limitation purge; DOUBLE-GATED, no-op by default)
 *
 * Times in Europe/Amsterdam.
 *
 * Manual run for testing:
 *   npx tsx supervisor.ts --run-now=weekly-digest
 */

import { spawn } from "node:child_process";
import cron from "node-cron";

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
  // PR-CHEF-12: daily chef-document expiry warnings (06:00 Amsterdam).
  { name: "document-expiry", schedule: "0 6 * * *", script: "document-expiry.ts" },
  // PR-AVG-3: storage-limitation purge (Sun 02:00 Amsterdam). DOUBLE-GATED —
  // RETENTION_ENABLED + RETENTION_DRY_RUN both default safe, so this is a
  // no-op ("disabled") until a human deliberately flips both flags.
  { name: "retention", schedule: "0 2 * * 0", script: "retention.ts" },
];

function ts(): string {
  return new Date().toISOString();
}

function runJob(job: Job): Promise<number> {
  return new Promise((resolve) => {
    console.log(`[${ts()}] [supervisor] starting ${job.name}`);
    const child = spawn("npx", ["tsx", job.script], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      console.log(
        `[${ts()}] [supervisor] ${job.name} exited code=${code ?? "null"}`,
      );
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      console.error(`[${ts()}] [supervisor] ${job.name} spawn error:`, err);
      resolve(1);
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
