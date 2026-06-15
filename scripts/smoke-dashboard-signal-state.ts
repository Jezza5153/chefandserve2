/**
 * Dashboard signal-state hide logic (DASH-3b) — the subtlest piece: a dismiss must
 * auto-clear when the underlying signal changes (fingerprint differs), and a snooze
 * must expire on time. Default is always "show". Pure function; imports the module
 * (which pulls in env), so run with an env file:
 *   npx tsx --env-file=.env.local scripts/smoke-dashboard-signal-state.ts
 */
import { isSignalHidden, userSignalKey } from "@/lib/domain/dashboard-signal-state";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const now = new Date("2026-06-15T12:00:00Z");
const future = new Date("2026-06-15T18:00:00Z");
const past = new Date("2026-06-15T06:00:00Z");
const base = { signalKey: "open_shift:abc", updatedBy: null, updatedAt: now };

console.log("=== Dashboard signal-state hide logic ===\n");

// No state row → always shown.
assert("no state → shown", isSignalHidden(undefined, "fp1", now) === false);

// Snooze.
assert("snooze in the future → hidden", isSignalHidden({ ...base, snoozeUntil: future, dismissedReason: null, fingerprint: null }, "fp1", now) === true);
assert("snooze in the past → shown", isSignalHidden({ ...base, snoozeUntil: past, dismissedReason: null, fingerprint: null }, "fp1", now) === false);

// Dismiss with fingerprint — auto-clears when the signal changes.
assert("dismiss + matching fingerprint → hidden", isSignalHidden({ ...base, snoozeUntil: null, dismissedReason: "bevestigd via telefoon", fingerprint: "fp1" }, "fp1", now) === true);
assert("dismiss + CHANGED fingerprint → shown (auto-clear)", isSignalHidden({ ...base, snoozeUntil: null, dismissedReason: "bevestigd via telefoon", fingerprint: "fp1" }, "fp2", now) === false);
assert("dismiss + null stored fingerprint → shown (nothing to match)", isSignalHidden({ ...base, snoozeUntil: null, dismissedReason: "x", fingerprint: null }, "fp1", now) === false);
assert("dismiss vs undefined live fingerprint, stored '' → hidden", isSignalHidden({ ...base, snoozeUntil: null, dismissedReason: "x", fingerprint: "" }, undefined, now) === true);

// Snooze takes precedence while active even if a (stale) dismiss exists.
assert("active snooze wins regardless of dismiss", isSignalHidden({ ...base, snoozeUntil: future, dismissedReason: "x", fingerprint: "other" }, "fp1", now) === true);

// Empty state row (both null) → shown.
assert("empty state row → shown", isSignalHidden({ ...base, snoozeUntil: null, dismissedReason: null, fingerprint: null }, "fp1", now) === false);

// Per-user keying (HARDEN-1): two users get distinct stored keys for the same signal.
assert("userSignalKey prefixes the user", userSignalKey("user-a", "open_shift:x") === "user-a:open_shift:x");
assert("userSignalKey isolates users", userSignalKey("user-a", "open_shift:x") !== userSignalKey("user-b", "open_shift:x"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
