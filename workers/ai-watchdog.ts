/**
 * ai-watchdog ticker — the §6 decision-point watchdog (stale open shifts / silent chefs /
 * low ratings → owner notifications with ready-to-use drafts).
 *
 * THIN SCHEDULER: the detectors live app-side at /api/cron/ai-watchdog (they reuse the shared
 * read-models behind the `@/` alias, which this standalone worker deploy can't import — same
 * reason as daily-briefing / onboarding-nudge). This worker just POSTs that endpoint daily; the
 * endpoint is per-entity throttled (6 days), so re-fires are harmless.
 *
 * Dark-launched: no-op unless AI_WATCHDOG_ENABLED=true (the endpoint re-checks the same flag).
 * Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/ai-watchdog.ts` (or via supervisor --run-now=ai-watchdog).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.AI_WATCHDOG_ENABLED === "true";

async function main(): Promise<void> {
  log("ai-watchdog: tick");
  if (!ENABLED) {
    log("ai-watchdog: disabled (AI_WATCHDOG_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("ai-watchdog: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/ai-watchdog`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`ai-watchdog: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ai-watchdog] FAILED:", err);
    process.exit(1);
  });
