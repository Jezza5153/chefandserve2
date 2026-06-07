/**
 * OpenAI implementation of the `Brain` interface — the LLM that decides which tool to
 * call (or how to answer). Dependency-free: talks to the Chat Completions API over an
 * injectable transport (real `fetch` by default, a stub in tests), so the whole agent
 * loop is testable with no SDK and no key.
 *
 * V1 simplification: the channel-agnostic Msg model is mapped onto OpenAI messages by
 * folding tool results into assistant context (no native tool_call_id threading). Good
 * enough for the loop; revisit if we need multi-call fidelity.
 */
import type { Brain, BrainStep, Msg } from "@/lib/ai/runtime/agent";
import type { ToolSpec } from "@/lib/ai/tools/registry";

export const DEFAULT_SYSTEM_PROMPT = [
  "Je bent de persoonlijke assistent van Maarten, eigenaar van Chef & Serve (een horeca-uitzendbureau).",
  "Je helpt hem het bedrijf runnen: data opvragen, herinneringen sturen, uren goedkeuren, enzovoort.",
  "",
  "Regels:",
  "- Gebruik UITSLUITEND de tools voor feiten en acties. Verzin nooit cijfers, namen of statussen — kun je iets niet via een tool ophalen, zeg dat dan eerlijk.",
  "- Voor acties die iets versturen of geld/onomkeerbaar raken: roep de tool aan; het systeem vraagt Maarten zelf om bevestiging. Doe nooit alsof iets al verstuurd of goedgekeurd is voordat het bevestigd is.",
  "- Antwoord kort en in het Nederlands, op de toon van een capabele rechterhand.",
  "- Je kunt nooit méér dan Maarten zelf mag; het systeem dwingt dat af.",
].join("\n");

export type OpenAiTransport = (req: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; json: unknown }>;

export type OpenAiBrainOptions = {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  transport?: OpenAiTransport;
  temperature?: number;
};

const defaultFetchTransport: OpenAiTransport = async (req) => {
  const r = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
};

export function createOpenAiBrain(opts: OpenAiBrainOptions): Brain {
  const transport = opts.transport ?? defaultFetchTransport;
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  return {
    async plan({ messages, tools }) {
      const payload: Record<string, unknown> = {
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        messages: toOpenAiMessages(system, messages),
      };
      if (tools.length > 0) {
        payload.tools = tools.map(toOpenAiTool);
        payload.tool_choice = "auto";
      }
      const res = await transport({
        url: "https://api.openai.com/v1/chat/completions",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(payload),
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`OpenAI API gaf status ${res.status}`);
      }
      return parseChoice(res.json);
    },
  };
}

function toOpenAiMessages(system: string, messages: Msg[]): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "assistant", content: `[resultaat van tool ${m.toolName ?? "?"}] ${m.content}` });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

// OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$ — no dots. Our tool ids are
// "resource.action", so map "." <-> "__" on the way out and back (tool names use single
// underscores only, so "__" is a safe, reversible delimiter).
const toOpenAiName = (name: string): string => name.replaceAll(".", "__");
const fromOpenAiName = (name: string): string => name.replaceAll("__", ".");

function toOpenAiTool(spec: ToolSpec) {
  return {
    type: "function",
    function: { name: toOpenAiName(spec.name), description: spec.description, parameters: spec.parameters },
  };
}

type OpenAiResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
};

function parseChoice(json: unknown): BrainStep {
  const msg = (json as OpenAiResponse).choices?.[0]?.message;
  const toolCalls = msg?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const fn = toolCalls[0]?.function;
    let input: unknown = {};
    if (typeof fn?.arguments === "string" && fn.arguments.trim()) {
      try {
        input = JSON.parse(fn.arguments);
      } catch {
        input = {};
      }
    }
    return { kind: "tool_call", tool: fromOpenAiName(String(fn?.name ?? "")), input };
  }
  return { kind: "final", text: typeof msg?.content === "string" ? msg.content : "" };
}
