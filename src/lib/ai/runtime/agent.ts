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
  /** Present on an assistant message that IS a single tool call — so the model sees its own call. */
  toolCall?: ToolCallRef;
  /** Present on an assistant message that batched MULTIPLE tool calls in one turn (parallel). */
  toolCalls?: ToolCallRef[];
  /** Present on a tool-result message: the call it answers + the tool name. */
  toolCallId?: string;
  toolName?: string;
};

export type BrainToolCall = { tool: string; input: unknown; call?: ToolCallRef };

export type BrainStep =
  // single tool call (scripted test brains use this shape)
  | { kind: "tool_call"; tool: string; input: unknown; call?: ToolCallRef }
  // one or more tool calls the model batched in a single turn — executed concurrently
  | { kind: "tool_calls"; calls: BrainToolCall[] }
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

    // Normalise the single (scripted) + batched (real model) shapes into one list, each with
    // a stable call ref. The model is told to batch independent tools in one turn; running
    // them together saves a model round-trip per extra tool (the big efficiency win).
    const rawCalls: BrainToolCall[] =
      step.kind === "tool_calls" ? step.calls : [{ tool: step.tool, input: step.input, call: step.call }];
    const calls = rawCalls.map((c, j) => ({
      tool: c.tool,
      input: c.input,
      call: c.call ?? { id: `call_${i}_${j}`, name: c.tool, arguments: safeArguments(c.input) },
    }));

    // The assistant turn lists ALL its calls (the API requires this before the matching tool
    // results). One message, N tool_calls — native parallel-tool-call threading.
    convo.push({ role: "assistant", content: "", toolCalls: calls.map((c) => c.call) });

    // Run them concurrently. Reads are independent; if one is an action, the confirm gate
    // returns needs_confirmation WITHOUT a side effect, so parallel execution is still safe.
    const ran = await Promise.all(
      calls.map(async (c) => {
        const tool = registry.get(c.tool);
        if (!tool) return { c, result: { status: "error", error: `Onbekende tool: ${c.tool}` } as ToolResult };
        return { c, result: await executeTool(tool, c.input, ctx, executeOptions) };
      }),
    );
    for (const { c, result } of ran) steps.push({ tool: c.tool, input: c.input, result });

    // Pause on the first action awaiting the human's OK. Reads in the same batch already ran
    // (side-effect-free); the channel re-reads next turn if it still needs them.
    const pend = ran.find((r) => r.result.status === "needs_confirmation");
    if (pend && pend.result.status === "needs_confirmation") {
      return {
        kind: "awaiting_confirmation",
        confirmation: pend.result.confirmation,
        pending: { tool: pend.c.tool, input: pend.c.input },
        steps,
      };
    }

    // Feed every call's result back, tied to its id, so the model sees all its answers and
    // can produce a final reply in the NEXT turn (instead of re-calling).
    for (const { c, result } of ran) {
      convo.push({ role: "tool", toolCallId: c.call.id, toolName: c.tool, content: toolMessage(result) });
    }
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
