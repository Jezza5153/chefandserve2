/**
 * Integration outbox — PR-CHEF-0.
 *
 * The pattern (see plan §"Integration principles"):
 *
 *   1. Business transaction mutates the entity + writes audit_log.
 *   2. AFTER the tx, caller invokes enqueueIntegrationEvent() with a
 *      stable idempotency key. Same key called twice → only one row
 *      (ON CONFLICT (idempotency_key) DO NOTHING).
 *   3. A worker (Railway cron) picks pending rows by (provider, nextAttemptAt)
 *      and delivers externally.
 *   4. On success: status='sent', sentAt=now(). On failure: attempts+=1,
 *      nextAttemptAt = now() + backoff, lastError = msg.
 *
 * Why outside the tx: external APIs (Payingit, accounting, calendar, push)
 * fail, time out, or rate-limit. Doing them inside the DB transaction would
 * make every hours-approval fragile. Outbox decouples the user's "Goedkeuren"
 * click from third-party reliability.
 *
 * Idempotency key format: `<eventType>:<entityId>[:<version>]`
 *   - hours.approved:abc-123             — one canonical event per row
 *   - chef.updated:def-456:v3            — version bump if same chef updated again
 */

import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { integrationOutbox } from "@/lib/db/schema";

export type EnqueueArgs = {
  provider: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type EnqueueResult =
  | { ok: true; outboxId: string; alreadyEnqueued: false }
  | { ok: true; outboxId: null; alreadyEnqueued: true }
  | { ok: false; error: string };

/**
 * Insert one outbox row, atomically deduped by idempotencyKey.
 *
 * Returns:
 *   - alreadyEnqueued=false + outboxId on first call.
 *   - alreadyEnqueued=true on subsequent identical calls (no-op).
 *
 * Never throws on the dedup path — the caller's tx already succeeded; we
 * MUST not blow up the request because of a duplicate enqueue.
 */
export async function enqueueIntegrationEvent(
  args: EnqueueArgs,
): Promise<EnqueueResult> {
  try {
    const result = await db
      .insert(integrationOutbox)
      .values({
        provider: args.provider,
        eventType: args.eventType,
        entityType: args.entityType,
        entityId: args.entityId,
        payloadJson: args.payload,
        idempotencyKey: args.idempotencyKey,
        // defaults: status=pending, attempts=0, nextAttemptAt=now()
      })
      .onConflictDoNothing({ target: integrationOutbox.idempotencyKey })
      .returning({ id: integrationOutbox.id });

    if (result.length === 0) {
      // Conflict → row exists for this idempotency key. Idempotent no-op.
      return { ok: true, outboxId: null, alreadyEnqueued: true };
    }
    return { ok: true, outboxId: result[0].id, alreadyEnqueued: false };
  } catch (err) {
    // Don't surface to caller — caller's business state is already saved.
    // Log + return error so callers can choose to alert if they want.
    const msg = err instanceof Error ? err.message : "unknown enqueue error";
    console.error("[outbox] enqueue failed:", msg, args);
    return { ok: false, error: msg };
  }
}

/**
 * Worker-side: fetch the next batch of pending rows for a provider.
 * Atomically claim them by flipping status='processing' so two workers
 * don't double-deliver.
 */
export async function claimPendingBatch(args: {
  provider: string;
  limit?: number;
}): Promise<typeof integrationOutbox.$inferSelect[]> {
  const limit = args.limit ?? 50;
  const claimed = await db.execute(sql`
    WITH due AS (
      SELECT id FROM integration_outbox
      WHERE provider = ${args.provider}
        AND status = 'pending'
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE integration_outbox
    SET status = 'processing'
    FROM due
    WHERE integration_outbox.id = due.id
    RETURNING integration_outbox.*
  `);
  const rows = Array.isArray(claimed)
    ? claimed
    : ((claimed as unknown as { rows?: unknown[] }).rows ?? []);
  return rows as typeof integrationOutbox.$inferSelect[];
}

/** Mark a claimed row as delivered. */
export async function markSent(outboxId: string): Promise<void> {
  await db
    .update(integrationOutbox)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(integrationOutbox.id, outboxId));
}

/**
 * Mark a claimed row as failed; schedule next attempt with exponential
 * backoff capped at 1 hour.
 *
 *   attempt 1 → +1 min
 *   attempt 2 → +5 min
 *   attempt 3 → +15 min
 *   attempt 4 → +30 min
 *   attempt 5+ → +60 min
 *
 * After 10 attempts, status stays at 'failed' without further auto-retry.
 * Admin retries manually from /admin/business/integrations/outbox.
 */
export async function markFailed(
  outboxId: string,
  error: string,
): Promise<void> {
  const [row] = await db
    .select({ attempts: integrationOutbox.attempts })
    .from(integrationOutbox)
    .where(eq(integrationOutbox.id, outboxId))
    .limit(1);
  const nextAttempts = (row?.attempts ?? 0) + 1;
  const backoffMin =
    nextAttempts === 1
      ? 1
      : nextAttempts === 2
        ? 5
        : nextAttempts === 3
          ? 15
          : nextAttempts === 4
            ? 30
            : 60;
  const final = nextAttempts >= 10;
  await db
    .update(integrationOutbox)
    .set({
      status: final ? "failed" : "pending",
      attempts: nextAttempts,
      lastError: error,
      nextAttemptAt: final
        ? new Date()
        : new Date(Date.now() + backoffMin * 60 * 1000),
    })
    .where(eq(integrationOutbox.id, outboxId));
}

/** Admin "retry now" — reset a failed row to pending immediately. */
export async function retryRow(outboxId: string): Promise<void> {
  await db
    .update(integrationOutbox)
    .set({
      status: "pending",
      nextAttemptAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(integrationOutbox.id, outboxId),
        eq(integrationOutbox.status, "failed"),
      ),
    );
}

/** Retention helper — called from workers/retention.ts. */
export async function pruneSent(olderThanDays: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(integrationOutbox)
    .where(
      and(
        eq(integrationOutbox.status, "sent"),
        lte(integrationOutbox.sentAt, cutoff),
      ),
    )
    .returning({ id: integrationOutbox.id });
  return result.length;
}
