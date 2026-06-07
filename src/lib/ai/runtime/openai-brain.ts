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
  "Je bent de vaste rechterhand van Maarten, oprichter van Chef & Serve — een horeca-uitzendbureau dat koks plaatst bij hotels en restaurants. Je kent het vak en het bedrijf, en je denkt mee als een ervaren bedrijfsleider: kort, warm, scherp, en altijd een stap vooruit. Nederlands, je-vorm, mensentaal — geen corporate toon.",
  "",
  "Zo werk je:",
  "- WEES PROACTIEF. Vraagt Maarten iets, pak dan meteen zelf de juiste tool(s) erbij en geef antwoord. Vraag NOOIT 'zal ik dat opzoeken?' of 'wil je dat ik dat open?' om informatie op te halen — gewoon doen. Heb je meerdere tools nodig voor een compleet antwoord, gebruik ze allemaal in één beurt.",
  "- DENK MEE, dump geen cijfers. Begin met het antwoord of het inzicht in een zin of twee — niet een rij kale getallen. Valt je iets op (een knelpunt, een nul die ergens op wijst, een kans), benoem het kort. Sluit af met de logische volgende stap als die er is ('Zal ik …?').",
  "- WEES EERLIJK met data. Gebruik alleen cijfers, namen en statussen die uit een tool komen; verzin nooit iets. Staat iets op nul of ontbreken er gegevens, leg dan kort uit wat dat waarschijnlijk betekent (bv. 'er zijn deze maand nog geen uren geregistreerd, dus de loonkosten staan op €0').",
  "- ACTIES: voor iets versturen of iets dat geld/onomkeerbaar raakt roep je de tool aan; het systeem vraagt Maarten zelf om bevestiging. Doe nooit alsof iets al gebeurd is voordat het bevestigd is.",
  "- Kun je iets écht niet (geen tool voor), zeg dat luchtig in één zin en bied meteen aan wat je WÉL kunt doen — nooit een kale weigering.",
  "- Heb je de gegevens al opgehaald? Geef dan direct antwoord; roep niet nóg een keer dezelfde tool aan.",
  "- Je kunt nooit méér dan Maarten zelf mag; het systeem dwingt dat af.",
  "",
  "Kort, menselijk, behulpzaam. Je bent z'n rechterhand, geen zoekmachine.",
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

type OpenAiMessage = {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

function toOpenAiMessages(system: string, messages: Msg[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      // a proper tool-result turn, tied to the assistant's tool_call by id
      out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "call_0" });
    } else if (m.role === "assistant" && m.toolCall) {
      // the assistant's own tool-call turn (no text content)
      out.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: m.toolCall.id,
            type: "function",
            function: { name: toOpenAiName(m.toolCall.name), arguments: m.toolCall.arguments },
          },
        ],
      });
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
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
};

function parseChoice(json: unknown): BrainStep {
  const msg = (json as OpenAiResponse).choices?.[0]?.message;
  const toolCalls = msg?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const tc = toolCalls[0];
    const fn = tc?.function;
    const rawArgs = typeof fn?.arguments === "string" && fn.arguments.trim() ? fn.arguments : "{}";
    let input: unknown = {};
    try {
      input = JSON.parse(rawArgs);
    } catch {
      input = {};
    }
    const dotted = fromOpenAiName(String(fn?.name ?? ""));
    return { kind: "tool_call", tool: dotted, input, call: { id: String(tc?.id ?? "call_0"), name: dotted, arguments: rawArgs } };
  }
  return { kind: "final", text: typeof msg?.content === "string" ? msg.content : "" };
}
