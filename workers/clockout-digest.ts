/**
 * clockout-digest ticker — CHEF-PR4b owner clock-out digest.
 *
 * THIN SCHEDULER: the digest builder lives app-side at /api/cron/clockout-digest
 * (it reuses the shared read-model + notifications behind the `@/` alias, which
 * this standalone worker deploy can't import — same reason as offer-expiry /
 * daily-briefing). This worker just POSTs that endpoint; the endpoint is throttled
 * to one digest per day, so re-fires are harmless.
 *
 * Dark-launched: no-op unless CLOCKOUT_DIGEST_ENABLED=true (the endpoint re-checks
 * the flag). Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/clockout-digest.ts` (or via supervisor --run-now=clockout-digest).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.CLOCKOUT_DIGEST_ENABLED === "true";

async function main(): Promise<void> {
  log("clockout-digest: tick");
  if (!ENABLED) {
    log("clockout-digest: disabled (CLOCKOUT_DIGEST_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("clockout-digest: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/clockout-digest`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`clockout-digest: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[clockout-digest] FAILED:", err);
    process.exit(1);
  });
