/**
 * onboarding-nudge ticker — the proactive onboarding chase (AI active → proactive).
 *
 * THIN SCHEDULER: the work is app-side at /api/cron/onboarding-nudge (it reuses the shared
 * read-models behind the `@/` alias, which this standalone worker deploy can't import — same
 * reason as daily-briefing / rag-ingest). This worker just POSTs that endpoint on its cron
 * (weekly, via supervisor.ts). The endpoint sweeps incomplete chef + client onboarding, nudges
 * each in-app, and summarises for Maarten — throttled per-user (6 days), so re-fires are harmless.
 *
 * Dark-launched: no-op unless ONBOARDING_NUDGE_ENABLED=true (the endpoint re-checks the same flag).
 * Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/onboarding-nudge.ts` (or via supervisor --run-now=onboarding-nudge).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.ONBOARDING_NUDGE_ENABLED === "true";

async function main(): Promise<void> {
  log("onboarding-nudge: tick");
  if (!ENABLED) {
    log("onboarding-nudge: disabled (ONBOARDING_NUDGE_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("onboarding-nudge: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/onboarding-nudge`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`onboarding-nudge: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[onboarding-nudge] FAILED:", err);
    process.exit(1);
  });
