/**
 * Shift status lifecycle (P3) — the single source of truth for deriving
 * `shifts.status` from the live placements + the shift's end time.
 *
 * The backbone `shifts` entity historically only ever moved `request → open`
 * (in `proposePlacement`); it never advanced to `filled` / `completed`. This
 * helper closes that gap: call it AFTER any placement transition (propose /
 * confirm / cancel / reject / complete) so the shift's status always reflects
 * reality. It is pure read-derive-write — no emails, no notifications — so it is
 * safe to call inside the same `withTx` as the placement mutation.
 *
 * Derivation (first match wins):
 *   1. `cancelled`  — a cancelled shift STAYS cancelled. The only way out is an
 *                     explicit re-open elsewhere; recompute never resurrects it.
 *   2. `completed`  — the shift has ended AND there is at least one non-cancelled
 *                     placement AND every non-cancelled placement is `completed`.
 *   3. `filled`     — confirmed placements ≥ the shift's needed headcount.
 *   4. `open`       — anything else (the working floor once matching has begun).
 *
 * Idempotent: writes only when the derived status differs from the stored one,
 * and returns the status the shift now holds.
 *
 * NB the `complete-placements` worker can't import this module (it runs
 * standalone off raw SQL, not src/lib) — it mirrors rule 2 inline. Keep the two
 * in sync.
 */

import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import type { TxConn } from "@/lib/db/tx";
import { placements, shifts } from "@/lib/db/schema";

/** Either the shared HTTP `db` or an interactive `withTx` transaction handle. */
type Conn = typeof db | TxConn;

type ShiftStatus = "request" | "open" | "filled" | "completed" | "cancelled";

/**
 * Cancel a shift + every still-live placement on it, atomically. PURE DB work
 * (no emails, no notifications, no audit) so it can be dropped into any caller's
 * `withTx` — the admin "Dienst annuleren" action AND the approve-a-cancel-request
 * path both reuse this so the cancel semantics stay in one place.
 *
 * Guards against double-cancel (`status != 'cancelled'`); returns whether the
 * shift was actually flipped. Confirmed chefs that need a heads-up can be
 * re-derived post-commit (cancelled placements with `confirmedAt` set).
 *
 * Takes a `TxConn` (not the union) because both call-sites run it inside a
 * `withTx` and it uses `.returning()`, whose overload differs between the
 * http + serverless drivers.
 */
export async function cancelShiftAndPlacements(
  shiftId: string,
  reason: string | null,
  conn: TxConn,
): Promise<{ changed: boolean }> {
  const now = new Date();
  const flipped = await conn
    .update(shifts)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledReason: reason,
      updatedAt: now,
    })
    .where(and(eq(shifts.id, shiftId), ne(shifts.status, "cancelled")))
    .returning({ id: shifts.id });
  if (flipped.length === 0) return { changed: false };

  await conn
    .update(placements)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(placements.shiftId, shiftId),
        // PR-PLANBORD-1: include "draft" so cancelling a shift also clears its
        // unpublished concepts (they'd otherwise dangle on a cancelled shift).
        inArray(placements.status, ["draft", "proposed", "accepted", "confirmed"]),
      ),
    );

  return { changed: true };
}

/**
 * Recompute + persist `shifts.status` for one shift from its live placements.
 * Pass the active `tx` to keep the write in the same transaction as the
 * placement change that triggered it; omit it to use the shared `db`.
 *
 * Returns the shift's status afterwards, or `null` if the shift doesn't exist.
 */
export async function recomputeShiftStatus(
  shiftId: string,
  conn: Conn = db,
): Promise<ShiftStatus | null> {
  const [shift] = await conn
    .select({
      status: shifts.status,
      endsAt: shifts.endsAt,
      headcount: shifts.headcount,
    })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift) return null;

  // 1. Cancelled is terminal for the purposes of recompute.
  if (shift.status === "cancelled") return "cancelled";

  // Count the live (non-cancelled) placements + how many are confirmed/completed.
  const live = await conn
    .select({ status: placements.status })
    .from(placements)
    .where(
      and(
        eq(placements.shiftId, shiftId),
        ne(placements.status, "cancelled"),
        // PR-PLANBORD-1: a draft is a private concept — it must NEVER move the
        // shift's status (open/filled/completed). Excluded from the live count.
        ne(placements.status, "draft"),
      ),
    );

  const nonCancelledCount = live.length;
  const completedCount = live.filter((p) => p.status === "completed").length;
  const confirmedCount = live.filter((p) => p.status === "confirmed").length;

  const ended = new Date(shift.endsAt).getTime() <= Date.now();
  // headcount column defaults to 1; guard anyway so "≥1 confirmed = filled"
  // holds even if a row somehow has a non-positive value.
  const neededHeadcount = shift.headcount && shift.headcount > 0 ? shift.headcount : 1;

  let next: ShiftStatus;
  if (ended && nonCancelledCount > 0 && completedCount === nonCancelledCount) {
    // 2. Shift is over and everyone who was on it finished.
    next = "completed";
  } else if (confirmedCount >= neededHeadcount) {
    // 3. Enough chefs locked in.
    next = "filled";
  } else {
    // 4. Working floor.
    next = "open";
  }

  if (next !== shift.status) {
    await conn
      .update(shifts)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(shifts.id, shiftId));
  }

  return next;
}
