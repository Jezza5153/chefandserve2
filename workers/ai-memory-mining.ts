/**
 * ai-memory-mining ticker — conversation→memory mining (durable facts said mid-chat become
 * PROPOSALS for Maarten; nothing is auto-remembered).
 *
 * THIN SCHEDULER: the mining lives app-side at /api/cron/ai-memory-mining (it needs the shared
 * read-models + OpenAI env behind the `@/` alias). This worker POSTs it daily; the endpoint is
 * per-user throttled (20h) and propose-only, so re-fires are harmless.
 *
 * Dark-launched: no-op unless AI_MEMORY_MINING_ENABLED=true (endpoint re-checks the same flag).
 * Needs CRON_SECRET + NEXT_PUBLIC_APP_URL on Railway.
 *
 * Run: `npx tsx workers/ai-memory-mining.ts` (or via supervisor --run-now=ai-memory-mining).
 */
import { log } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;
const ENABLED = process.env.AI_MEMORY_MINING_ENABLED === "true";

async function main(): Promise<void> {
  log("ai-memory-mining: tick");
  if (!ENABLED) {
    log("ai-memory-mining: disabled (AI_MEMORY_MINING_ENABLED != true) → skip");
    return;
  }
  if (!SECRET) {
    log("ai-memory-mining: no CRON_SECRET → skip");
    return;
  }
  const res = await fetch(`${APP}/api/cron/ai-memory-mining`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`ai-memory-mining: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ai-memory-mining] FAILED:", err);
    process.exit(1);
  });
