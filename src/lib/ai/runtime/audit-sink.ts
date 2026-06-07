/**
 * The real audit sink — writes one `ai.tool_*` row per executor event to `audit_log`.
 *
 * This is the META trail: who asked the assistant to do what, via which channel, and
 * the outcome (invoked / completed / blocked / failed). The BUSINESS row (e.g.
 * `shift_hours.admin_approved`) is written by the tool's own handler, giving the
 * dual-row trail the design calls for. Worker/route-safe (uses `recordAuditCore`,
 * never the request-scoped writer).
 */
import { recordAuditCore } from "@/lib/audit";
import type { AiAuditEvent } from "@/lib/ai/types";

const ACTION_FOR: Record<AiAuditEvent["kind"], string> = {
  invoked: "ai.tool_invoked",
  completed: "ai.tool_completed",
  blocked: "ai.tool_blocked",
  failed: "ai.tool_failed",
};

export async function aiAuditSink(event: AiAuditEvent): Promise<void> {
  await recordAuditCore({
    userId: event.actor.paServiceUserId,
    action: ACTION_FOR[event.kind],
    resource: "ai_tool",
    resourceId: event.resourceId ?? event.tool,
    after: {
      tool: event.tool,
      risk: event.risk,
      channel: event.channel,
      _ai: {
        requestedBy: event.actor.requestedByUserId,
        role: event.actor.requestedByRole,
        ...(event.reason ? { reason: event.reason } : {}),
      },
      ...(event.detail ? { detail: event.detail } : {}),
    },
  });
}
