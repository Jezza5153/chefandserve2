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

export type ToolCallRef = { id: string; name: string; arguments: string };

export type Msg = {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present on an assistant message that IS a tool call — so the model sees its own call. */
  toolCall?: ToolCallRef;
  /** Present on a tool-result message: the call it answers + the tool name. */
  toolCallId?: string;
  toolName?: string;
};

export type BrainStep =
  | { kind: "tool_call"; tool: string; input: unknown; call?: ToolCallRef }
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
  /** Cap on conversation-history messages kept (most recent), so a long session can't
   *  overflow the model's context window. Default 24. */
  maxHistoryMessages?: number;
};

export async function runAgent(args: RunAgentArgs): Promise<AgentOutcome> {
  const { brain, registry, ctx, executeOptions } = args;
  const convo: Msg[] = capRecentHistory(args.messages, args.maxHistoryMessages ?? 24);
  const steps: AgentStep[] = [];
  const maxSteps = args.maxSteps ?? 8;

  for (let i = 0; i < maxSteps; i++) {
    const step = await brain.plan({ messages: convo, tools: registry.specs() });

    if (step.kind === "final") {
      return { kind: "final", text: step.text, steps };
    }

    // Record the assistant's tool-call turn, then the tool result as a proper `tool`
    // message tied to it by id. This native threading is what lets the model SEE that its
    // own call was answered and then produce a final reply — without it the model doesn't
    // recognise the result and re-calls the tool until maxSteps ("maximum aantal stappen").
    const call: ToolCallRef = step.call ?? {
      id: `call_${i}`,
      name: step.tool,
      arguments: safeArguments(step.input),
    };

    const tool = registry.get(step.tool);
    if (!tool) {
      convo.push({ role: "assistant", content: "", toolCall: call });
      convo.push({ role: "tool", toolCallId: call.id, toolName: step.tool, content: `Onbekende tool: ${step.tool}` });
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

    convo.push({ role: "assistant", content: "", toolCall: call });
    convo.push({ role: "tool", toolCallId: call.id, toolName: step.tool, content: toolMessage(result) });
  }

  // Step budget exhausted. Make one last call with NO tools so the model must answer in
  // words using whatever it already gathered, instead of a dead-end "max steps" message.
  try {
    const finalStep = await brain.plan({ messages: convo, tools: [] });
    if (finalStep.kind === "final" && finalStep.text.trim()) {
      return { kind: "final", text: finalStep.text, steps };
    }
  } catch {
    // fall through to the safe fallback below
  }
  return {
    kind: "final",
    text: "Ik kon dit niet helemaal afronden — kun je het iets specifieker vragen?",
    steps,
  };
}

function toolMessage(result: ToolResult): string {
  switch (result.status) {
    case "ok": {
      // Feed the STRUCTURED data back to the brain, not just the human summary. The
      // summary is a short headline and usually omits the exact number/name the user
      // asked for; without the data the brain can't see its own tool's output and just
      // re-calls the tool until maxSteps ("maximum aantal stappen bereikt"). Capped so a
      // large snapshot can't blow the context window.
      const json = jsonForBrain(result.data);
      return json ? `${result.summary}\n\nData (JSON): ${json}` : result.summary;
    }
    case "denied":
      return `[geweigerd] ${result.reason}`;
    case "error":
      return `[fout] ${result.error}`;
    default:
      return "[onbekend]";
  }
}

function jsonForBrain(data: unknown): string {
  if (data === undefined || data === null) return "";
  try {
    const s = JSON.stringify(data);
    if (!s || s === "{}" || s === "[]") return "";
    const MAX = 6000;
    return s.length > MAX ? `${s.slice(0, MAX)}…(ingekort)` : s;
  } catch {
    return "";
  }
}

function safeArguments(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

/** Keep only the most recent `max` messages so a long conversation can't overflow the
 *  model's context window. Skips a leading orphaned tool result (its assistant tool_call
 *  would otherwise be dropped, which the API rejects). */
function capRecentHistory(messages: Msg[], max: number): Msg[] {
  if (max <= 0 || messages.length <= max) return [...messages];
  let start = messages.length - max;
  while (start < messages.length && messages[start]?.role === "tool") start += 1;
  return messages.slice(start);
}
