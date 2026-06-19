/**
 * shift-reminders ticker — CHEF-PR4 shift-relative reminders.
 *
 * THIN SCHEDULER: the logic lives app-side at /api/cron/shift-reminders (it reuses
 * the shared schema + notifyUser behind the `@/` alias, which this standalone
 * worker deploy can't import — same reason as offer-expiry / daily-briefing). This
 * worker just POSTs that endpoint; the endpoint dedupes per (placement, tier), so
 * re-fires are harmless.
 *
 * Runs every 15 min so the ~24h / ~2h / ~15min tiers fire close to their windows.
 * Dark-launched: no-op unless SHIFT_REMINDERS_ENABLED=true (the endpoint re-checks
 * the flag). Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/shift-reminders.ts` (or via supervisor --run-now=shift-reminders).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.SHIFT_REMINDERS_ENABLED === "true";

async function main(): Promise<void> {
  log("shift-reminders: tick");
  if (!ENABLED) {
    log("shift-reminders: disabled (SHIFT_REMINDERS_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("shift-reminders: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/shift-reminders`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`shift-reminders: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[shift-reminders] FAILED:", err);
    process.exit(1);
  });
