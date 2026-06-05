// PR-SET-1 smoke — the hours-reminders worker honors the DB feature flag in
// business_settings, with the env var as a hard kill-switch.
// Non-destructive: cleans up its business_settings row in finally. Run:
//   node scripts/smoke-business-settings.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

function runWorker(extraEnv = {}) {
  try {
    return execSync("npx tsx workers/hours-reminders.ts", {
      stdio: "pipe",
      env: { ...process.env, ...extraEnv },
    }).toString();
  } catch (e) {
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
  }
}

try {
  console.log("=== business-settings / hours-reminders flag smoke ===\n");
  await sql`DELETE FROM business_settings WHERE key='hours_reminders'`;

  // 1. No flag row → worker disabled (safe default).
  let out = runWorker({ HOURS_REMINDERS_ENABLED: "" });
  assert("no flag row → disabled", /disabled/.test(out), out.trim().split("\n").pop());

  // 2. Flag enabled=false → disabled.
  await sql`INSERT INTO business_settings (key, value) VALUES ('hours_reminders', '{"enabled": false}'::jsonb)
            ON CONFLICT (key) DO UPDATE SET value='{"enabled": false}'::jsonb`;
  out = runWorker({ HOURS_REMINDERS_ENABLED: "" });
  assert("flag enabled=false → disabled", /disabled/.test(out));

  // 3. Flag enabled=true → worker runs the ladder (reaches "done", not "disabled").
  await sql`UPDATE business_settings SET value='{"enabled": true}'::jsonb WHERE key='hours_reminders'`;
  out = runWorker({ HOURS_REMINDERS_ENABLED: "" });
  assert(
    "flag enabled=true → worker runs (not disabled)",
    !/disabled/.test(out) && /done/.test(out),
    out.trim().split("\n").pop(),
  );

  // 4. env kill-switch (HOURS_REMINDERS_ENABLED=false) overrides the DB flag.
  out = runWorker({ HOURS_REMINDERS_ENABLED: "false" });
  assert("env kill-switch overrides DB flag → disabled", /disabled/.test(out));
} finally {
  await sql`DELETE FROM business_settings WHERE key='hours_reminders'`;
}

console.log(`\n=== business-settings smoke: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
