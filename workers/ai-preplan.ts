/**
 * ai-preplan ticker — the nightly pre-plan: autofillWeek drafts the coming week's open slots
 * as concepts while everyone sleeps; the planner reviews & publishes in the morning.
 *
 * THIN SCHEDULER: the work lives app-side at /api/cron/ai-preplan (shared domain behind `@/`).
 * Idempotent (covered slots skipped), so re-fires are harmless.
 *
 * Dark-launched: no-op unless AI_PREPLAN_ENABLED=true (endpoint re-checks the same flag).
 * Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/ai-preplan.ts` (or via supervisor --run-now=ai-preplan).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.AI_PREPLAN_ENABLED === "true";

async function main(): Promise<void> {
  log("ai-preplan: tick");
  if (!ENABLED) {
    log("ai-preplan: disabled (AI_PREPLAN_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("ai-preplan: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/ai-preplan`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`ai-preplan: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ai-preplan] FAILED:", err);
    process.exit(1);
  });
