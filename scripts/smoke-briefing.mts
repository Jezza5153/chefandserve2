/**
 * Live smoke for the daily-briefing read-model + config.
 *   npx tsx --env-file=.env.local scripts/smoke-briefing.mts
 * Read-only (no sends). Asserts the briefing shape/sections + the settings-config defaults.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  cond ? pass++ : fail++;
};

const { buildDailyBriefing } = await import("@/lib/ai/read-model/briefing");
const { getDailyBriefingConfig } = await import("@/lib/business-settings");

const b = await buildDailyBriefing(new Date());
ok(/^\d{4}-\d{2}-\d{2}$/.test(b.date), `date is an Amsterdam day-key (${b.date})`);
ok(typeof b.text === "string" && b.text.length > 0, "text is non-empty");
ok(b.text.startsWith("Goedemorgen Maarten"), "briefing is addressed to Maarten");
ok(b.text.includes("Gisteren") && b.text.includes("Vandaag"), "text has both GISTEREN + VANDAAG sections");
ok(typeof b.hasUrgent === "boolean", `hasUrgent is boolean (${b.hasUrgent})`);

const d = b.data;
const counts = [
  d.yesterday.shifts,
  d.yesterday.unresolvedHours,
  d.yesterday.newClientComments,
  d.today.shifts,
  d.today.openShifts,
  d.today.hoursAwaitingApproval,
  d.today.expiringDocs,
];
ok(counts.every((n) => typeof n === "number" && n >= 0), "all data counts are non-negative numbers");

const cfg = await getDailyBriefingConfig();
ok(typeof cfg.enabled === "boolean", `config.enabled is boolean (default ${cfg.enabled})`);
ok(cfg.hour >= 0 && cfg.hour <= 23, `config.hour in 0–23 (${cfg.hour})`);
ok(typeof cfg.channels.app === "boolean" && typeof cfg.channels.email === "boolean", "config.channels app+email present");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
