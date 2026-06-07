/**
 * The channel-agnostic agent loop. Given a pluggable "brain" (the real LLM later, or a
 * scripted stand-in for tests), it lets the brain choose tools, runs each through the
 * executor, and either finishes with a message or PAUSES to ask the human to confirm.
 *
 * The brain is an interface, so the dashboard, WhatsApp and voice channels all reuse
 * this exact loop — and the whole thing is testable with zero LLM calls.
 */
import type { ConfirmationRequest, ToolContext, ToolResult } from "@/lib/ai/types";
import type { ToolRegistry, ToolSpec } from "@/lib/ai/tools/registry";
import { executeTool, type ExecuteOptions } from "@/lib/ai/runtime/execute";

export type Msg = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
};

export type BrainStep =
  | { kind: "tool_call"; tool: string; input: unknown }
  | { kind: "final"; text: string };

/** The pluggable reasoning layer. The real implementation calls the LLM; tests script it. */
export interface Brain {
  plan(args: { messages: Msg[]; tools: ToolSpec[] }): Promise<BrainStep>;
}

export type AgentStep = { tool: string; input: unknown; result: ToolResult };

export type AgentOutcome =
  | { kind: "final"; text: string; steps: AgentStep[] }
  | {
      kind: "awaiting_confirmation";
      confirmation: ConfirmationRequest;
      pending: { tool: string; input: unknown };
      steps: AgentStep[];
    };

export type RunAgentArgs = {
  brain: Brain;
  registry: ToolRegistry;
  messages: Msg[];
  ctx: ToolContext;
  executeOptions: ExecuteOptions;
  maxSteps?: number;
};

export async function runAgent(args: RunAgentArgs): Promise<AgentOutcome> {
  const { brain, registry, ctx, executeOptions } = args;
  const convo: Msg[] = [...args.messages];
  const steps: AgentStep[] = [];
  const maxSteps = args.maxSteps ?? 8;

  for (let i = 0; i < maxSteps; i++) {
    const step = await brain.plan({ messages: convo, tools: registry.specs() });

    if (step.kind === "final") {
      return { kind: "final", text: step.text, steps };
    }

    const tool = registry.get(step.tool);
    if (!tool) {
      convo.push({ role: "tool", toolName: step.tool, content: `Onbekende tool: ${step.tool}` });
      continue;
    }

    const result = await executeTool(tool, step.input, ctx, executeOptions);
    steps.push({ tool: step.tool, input: step.input, result });

    // Pause the moment an action needs the human's OK — the channel renders the confirm gesture.
    if (result.status === "needs_confirmation") {
      return {
        kind: "awaiting_confirmation",
        confirmation: result.confirmation,
        pending: { tool: step.tool, input: step.input },
        steps,
      };
    }

    convo.push({ role: "tool", toolName: step.tool, content: toolMessage(result) });
  }

  return { kind: "final", text: "Ik heb het maximum aantal stappen bereikt zonder af te ronden.", steps };
}

function toolMessage(result: ToolResult): string {
  switch (result.status) {
    case "ok":
      return result.summary;
    case "denied":
      return `[geweigerd] ${result.reason}`;
    case "error":
      return `[fout] ${result.error}`;
    default:
      return "[onbekend]";
  }
}
