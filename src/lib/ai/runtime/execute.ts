/**
 * The gate. Every tool call — from any channel — passes through here, in order:
 *   1. validate inputs       (bad args never reach a handler)
 *   2. permission ceiling    (the assistant can never exceed the human's RBAC)
 *   3. confirmation gate      (outbound/financial actions need a signed human "yes")
 *   4. run + audit            (invoked → completed/failed, always recorded)
 *
 * The audit sink and confirm secret are INJECTED so this module stays pure and
 * unit-testable with no DB, env, or LLM.
 */
import type { AiAuditEvent, AnyTool, ToolContext, ToolResult } from "@/lib/ai/types";
import { hashInput, mintConfirmToken, verifyConfirmToken } from "@/lib/ai/runtime/confirm-token";

export type ExecuteOptions = {
  auditSink: (event: AiAuditEvent) => Promise<void>;
  confirmSecret: string;
  now?: number;
};

export async function executeTool(
  tool: AnyTool,
  rawInput: unknown,
  ctx: ToolContext,
  opts: ExecuteOptions,
): Promise<ToolResult> {
  const audit = (
    kind: AiAuditEvent["kind"],
    extra?: { reason?: string; resourceId?: string | null; detail?: Record<string, unknown> },
  ): Promise<void> =>
    opts.auditSink({
      kind,
      tool: tool.name,
      risk: tool.risk,
      actor: ctx.actor,
      channel: ctx.channel,
      ...(extra?.reason ? { reason: extra.reason } : {}),
      ...(extra && "resourceId" in extra ? { resourceId: extra.resourceId } : {}),
      ...(extra?.detail ? { detail: extra.detail } : {}),
    });

  // 1. validate inputs
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    await audit("failed", { reason: "invalid_input", detail: { issues: parsed.error.issues } });
    return { status: "error", error: `Ongeldige invoer voor "${tool.title}".` };
  }
  const input = parsed.data;

  // 2. permission ceiling — the assistant inherits the human's RBAC and may not exceed it
  if (tool.permission) {
    const key = `${tool.permission.resource}.${tool.permission.action}`;
    if (!ctx.actor.effectivePerms.has(key)) {
      await audit("blocked", { reason: "perm_denied", detail: { permission: key } });
      return { status: "denied", reason: `Je hebt geen rechten voor "${key}".` };
    }
  }

  // 3. confirmation gate — outbound + financial actions require a signed human "yes"
  if (tool.risk === "outbound" || tool.risk === "financial") {
    const tokenArgs = {
      tool: tool.name,
      inputHash: hashInput(input),
      actorUserId: ctx.actor.requestedByUserId,
      secret: opts.confirmSecret,
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    };
    if (!ctx.confirmation) {
      const token = mintConfirmToken(tokenArgs);
      await audit("blocked", { reason: "needs_confirmation" });
      const summary = tool.describeAction ? tool.describeAction(input, ctx) : tool.title;
      return { status: "needs_confirmation", confirmation: { tool: tool.name, risk: tool.risk, summary, token } };
    }
    if (!verifyConfirmToken({ ...tokenArgs, token: ctx.confirmation })) {
      await audit("blocked", { reason: "bad_confirmation" });
      return {
        status: "denied",
        reason:
          "Bevestiging verlopen of ongeldig — vraag de AI om de actie opnieuw op te stellen. De gegevens kunnen inmiddels veranderd zijn, dus check ze nog even voor je bevestigt.",
      };
    }
  }

  // 4. run + audit
  await audit("invoked");
  try {
    const result = await tool.run(input, ctx);
    await audit("completed", { resourceId: extractResourceId(result.data) });
    return { status: "ok", data: result.data, summary: result.summary };
  } catch (err) {
    await audit("failed", { reason: "exception", detail: { message: errorMessage(err) } });
    return { status: "error", error: `"${tool.title}" is niet gelukt: ${errorMessage(err)}` };
  }
}

function extractResourceId(data: unknown): string | null {
  if (data && typeof data === "object" && "id" in data) {
    const id = (data as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
