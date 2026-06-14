/**
 * push-deliver ticker — drains the web_push outbox to phones (CHEF-14).
 *
 * THIN SCHEDULER: the work lives app-side at /api/cron/deliver-push (it needs the
 * `web-push` lib + `@/` subscription read-model). This worker just POSTs it every
 * couple of minutes so a shift-proposal/confirm buzzes the chef's phone promptly.
 *
 * Idempotent (outbox idempotency key + claimed rows aren't re-sent). Dark: no-op
 * unless WEB_PUSH_ENABLED=true (the endpoint re-checks). Needs CRON_SECRET +
 * NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/push-deliver.ts` (or via supervisor --run-now=push-deliver).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.WEB_PUSH_ENABLED === "true";

async function main(): Promise<void> {
  if (!ENABLED) {
    log("push-deliver: disabled (WEB_PUSH_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("push-deliver: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/deliver-push`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`push-deliver: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[push-deliver] FAILED:", err);
    process.exit(1);
  });
