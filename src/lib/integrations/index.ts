/**
 * Integration spine — public API barrel.
 *
 * Import from "@/lib/integrations" everywhere. The submodules
 * (outbox.ts / notifications.ts / email.ts / external-refs.ts / health.ts)
 * are implementation details.
 *
 * Rules of use (see plan §"Integration principles"):
 *   1. Approve hours / sign hours / confirm shift → call enqueueIntegrationEvent
 *      AFTER the DB transaction. Same idempotency key on retry = no-op.
 *   2. Every sendEmail() is paired with recordEmailMessage(providerMessageId, ...).
 *   3. Every user-visible event creates a notification (in-app inbox).
 *   4. External IDs (payingit employee id, etc.) go in external_refs, never
 *      on the entity table.
 */

export {
  claimPendingBatch,
  enqueueIntegrationEvent,
  markFailed,
  markSent,
  pruneSent,
  retryRow,
  type EnqueueArgs,
  type EnqueueResult,
} from "./outbox";

export {
  createNotification,
  createNotificationsFanOut,
  getUnreadCount,
  listRecent,
  markAllRead,
  markRead,
  pruneOld as pruneOldNotifications,
  type CreateNotificationArgs,
} from "./notifications";

export {
  counts as emailCounts,
  emailStatusFromProviderEvent,
  listForEntity as listEmailsForEntity,
  recentBounces,
  recordEmailEventFromWebhook,
  recordEmailMessage,
  type RecordEmailMessageArgs,
} from "./email";

export {
  resolveByExternalId,
  resolveExternalRef,
  upsertExternalRef,
  type UpsertExternalRefArgs,
} from "./external-refs";

export {
  getIntegrationHealth,
  invalidateHealthCache,
  listPendingOutbox,
  listRecentBounces,
  listRecentRuns,
  type HealthSummary,
} from "./health";
