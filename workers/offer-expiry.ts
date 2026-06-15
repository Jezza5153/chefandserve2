/**
 * offer-expiry ticker — CHEF-PR2 offer-lifecycle sweep.
 *
 * THIN SCHEDULER: the detector lives app-side at /api/cron/offer-expiry (it reuses the
 * shared schema/notifications behind the `@/` alias, which this standalone worker deploy
 * can't import — same reason as ai-watchdog / daily-briefing). This worker just POSTs that
 * endpoint; the endpoint is per-placement throttled (6 days), so re-fires are harmless.
 *
 * Dark-launched: no-op unless OFFER_EXPIRY_SWEEP_ENABLED=true (the endpoint re-checks the flag).
 * Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/offer-expiry.ts` (or via supervisor --run-now=offer-expiry).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.OFFER_EXPIRY_SWEEP_ENABLED === "true";

async function main(): Promise<void> {
  log("offer-expiry: tick");
  if (!ENABLED) {
    log("offer-expiry: disabled (OFFER_EXPIRY_SWEEP_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("offer-expiry: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/offer-expiry`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`offer-expiry: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[offer-expiry] FAILED:", err);
    process.exit(1);
  });
