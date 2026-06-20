/**
 * smoke-tz-day — pure checks for the Amsterdam calendar-day helper that fixes the
 * blocked-date off-by-one. No DB/LLM; the module has no app imports → clean dynamic import.
 */
const { amsterdamDayKey, amsterdamCalendarDayUTC } = await import("../src/lib/tz-day.ts");

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else fail.push(name);
}
const iso = (d: Date) => d.toISOString();

// SUMMER (CEST, UTC+2): a shift at 01:00 Amsterdam on the 16th = 23:00 UTC on the 15th. The
// local day (16th) must win — this is the exact case the bug missed (past-midnight shifts).
ok("summer 01:00 local → local day key", amsterdamDayKey("2026-06-15T23:00:00.000Z") === "2026-06-16");
ok("summer 01:00 local → UTC-midnight of local day", iso(amsterdamCalendarDayUTC("2026-06-15T23:00:00.000Z")) === "2026-06-16T00:00:00.000Z");
ok("(contrast) naive UTC day would wrongly be the 15th", iso(amsterdamCalendarDayUTC("2026-06-15T23:00:00.000Z")) !== "2026-06-15T00:00:00.000Z");

// SUMMER daytime: 14:00 Amsterdam = 12:00 UTC same day → unchanged.
ok("summer daytime same day", iso(amsterdamCalendarDayUTC("2026-06-16T12:00:00.000Z")) === "2026-06-16T00:00:00.000Z");

// WINTER (CET, UTC+1): 00:30 Amsterdam on 16 Jan = 23:30 UTC on 15 Jan → local day = 16th.
ok("winter 00:30 local → local day", amsterdamDayKey("2026-01-15T23:30:00.000Z") === "2026-01-16");
ok("winter 00:30 local → UTC-midnight 16th", iso(amsterdamCalendarDayUTC("2026-01-15T23:30:00.000Z")) === "2026-01-16T00:00:00.000Z");

// Early breakfast prep: 05:00 Amsterdam summer = 03:00 UTC same day → unchanged.
ok("breakfast 05:00 local same day", iso(amsterdamCalendarDayUTC("2026-06-16T03:00:00.000Z")) === "2026-06-16T00:00:00.000Z");

// Accepts a Date instance too.
ok("accepts Date instance", amsterdamDayKey(new Date("2026-06-15T23:00:00.000Z")) === "2026-06-16");

// Result is always UTC-midnight (matches the stored convention).
{
  const d = amsterdamCalendarDayUTC("2026-06-15T23:00:00.000Z");
  ok("always UTC midnight", d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
}

if (fail.length) {
  console.error(`smoke-tz-day FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-tz-day OK — ${pass} checks passed`);
