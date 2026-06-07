/**
 * Owner-assistant orchestration — the thin glue a channel (dashboard route, later a
 * WhatsApp webhook / voice handler) calls. Resolves the acting identity, builds the
 * registry, and runs the agent (or executes a single confirmed action). The brain is
 * passed in by the channel so this stays independent of any specific LLM.
 */
import type { AiChannel, ToolContext, ToolResult } from "@/lib/ai/types";
import { resolveAiActor } from "@/lib/ai/runtime/actor";
import { aiAuditSink } from "@/lib/ai/runtime/audit-sink";
import { executeTool } from "@/lib/ai/runtime/execute";
import { runAgent, type AgentOutcome, type Brain, type Msg } from "@/lib/ai/runtime/agent";
import { buildRegistry } from "@/lib/ai/tools/index";

export async function runOwnerAssistant(args: {
  userId: string;
  channel: AiChannel;
  messages: Msg[];
  brain: Brain;
  confirmSecret: string;
  reason?: string;
}): Promise<AgentOutcome> {
  const actor = await resolveAiActor(args.userId);
  const registry = buildRegistry();
  const ctx: ToolContext = {
    actor,
    channel: args.channel,
    ...(args.reason ? { reason: args.reason } : {}),
  };
  return runAgent({
    brain: args.brain,
    registry,
    messages: args.messages,
    ctx,
    executeOptions: { auditSink: aiAuditSink, confirmSecret: args.confirmSecret },
  });
}

/** Execute a single action the human just confirmed (echoing back the signed token). */
export async function confirmOwnerAction(args: {
  userId: string;
  channel: AiChannel;
  tool: string;
  input: unknown;
  token: string;
  confirmSecret: string;
  reason?: string;
}): Promise<ToolResult> {
  const actor = await resolveAiActor(args.userId);
  const tool = buildRegistry().get(args.tool);
  if (!tool) return { status: "error", error: `Onbekende tool: ${args.tool}` };
  const ctx: ToolContext = {
    actor,
    channel: args.channel,
    confirmation: args.token,
    ...(args.reason ? { reason: args.reason } : {}),
  };
  return executeTool(tool, args.input, ctx, { auditSink: aiAuditSink, confirmSecret: args.confirmSecret });
}
