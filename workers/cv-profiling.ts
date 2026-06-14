/**
 * cv-profiling ticker — nightly CV → profile-suggestion sweep (CV-AI-1).
 *
 * THIN SCHEDULER: the work lives app-side at /api/cron/cv-profiling (it needs the
 * `@/` read-models: CV extraction + the profile-suggestions domain). This worker
 * only POSTs the endpoint with the cron secret.
 *
 * Idempotent (suggestions skip fields already decided for the same CV version),
 * so re-fires are harmless. Dark-launched: no-op unless CV_AI_PROFILING_ENABLED=
 * true (the endpoint re-checks the same flag). Needs CRON_SECRET +
 * NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/cv-profiling.ts` (or via supervisor --run-now=cv-profiling).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.CV_AI_PROFILING_ENABLED === "true";

async function main(): Promise<void> {
  log("cv-profiling: tick");
  if (!ENABLED) {
    log("cv-profiling: disabled (CV_AI_PROFILING_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("cv-profiling: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/cv-profiling`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`cv-profiling: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cv-profiling] FAILED:", err);
    process.exit(1);
  });
