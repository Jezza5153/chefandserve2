/**
 * daily-briefing ticker.
 *
 * The owner's "dagstart" (yesterday recap + today forecast) is BUILT app-side at
 * /api/cron/daily-briefing — it reuses the shared read-model behind the `@/` alias, which
 * this standalone worker deploy can't import (same reason as rag-ingest). So this worker is
 * just a THIN SCHEDULER: it runs hourly (Europe/Amsterdam, via supervisor.ts), reads the
 * owner's chosen hour from business_settings['daily_briefing'], and — when the current
 * Amsterdam hour matches and the feature is enabled — POSTs the endpoint, which does the
 * work and is idempotent (so re-fires are harmless).
 *
 * Needs CRON_SECRET (to authorize the endpoint) + NEXT_PUBLIC_APP_URL on Railway. Default
 * OFF (no enabled flag → skip), so it never fires until Maarten opts in via the UI.
 *
 * Run: `npx tsx workers/daily-briefing.ts`
 */
import { log, sql } from "./_lib";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";
const SECRET = process.env.CRON_SECRET;

/** Current hour (0–23) in Europe/Amsterdam — DST-correct via the Intl timezone. */
function amsterdamHour(): number {
  const s = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Amsterdam",
  }).format(new Date());
  return Number(s);
}

async function main(): Promise<void> {
  log("daily-briefing: tick");
  if (!SECRET) {
    log("daily-briefing: no CRON_SECRET → skip");
    return;
  }
  const rows = (await sql`
    SELECT value->>'enabled' AS enabled, value->>'hour' AS hour
    FROM business_settings WHERE key = 'daily_briefing' LIMIT 1
  `) as Array<{ enabled: string | null; hour: string | null }>;
  const row = rows[0];
  if (row?.enabled !== "true") {
    log("daily-briefing: disabled (business_settings 'daily_briefing' off) → skip");
    return;
  }
  const wantHour = row.hour != null && row.hour !== "" ? Number(row.hour) : 7;
  const nowHour = amsterdamHour();
  if (nowHour !== wantHour) {
    log(`daily-briefing: not the hour (now ${nowHour}, want ${wantHour}) → skip`);
    return;
  }

  const res = await fetch(`${APP}/api/cron/daily-briefing`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text().catch(() => "");
  log(`daily-briefing: triggered endpoint → HTTP ${res.status} ${body.slice(0, 200)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[daily-briefing] FAILED:", err);
    process.exit(1);
  });
