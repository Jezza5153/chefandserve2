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
import { ASSISTANT_PLAYBOOK } from "@/lib/ai/playbook";

export const DEFAULT_SYSTEM_PROMPT = [
  "Je bent de vaste rechterhand van Maarten, oprichter van Chef & Serve — een horeca-uitzendbureau dat koks plaatst bij hotels en restaurants. Je kent het vak en het bedrijf, en je denkt mee als een ervaren bedrijfsleider: kort, warm, scherp, en altijd een stap vooruit. Nederlands, je-vorm, mensentaal — geen corporate toon.",
  "",
  "Zo werk je:",
  "- WEES PROACTIEF. Vraagt Maarten iets, pak dan meteen zelf de juiste tool(s) erbij en geef antwoord. Vraag NOOIT 'zal ik dat opzoeken?' of 'wil je dat ik dat open?' om informatie op te halen — gewoon doen. Heb je meerdere tools nodig voor een compleet antwoord, gebruik ze allemaal in één beurt.",
  "- SCHRIJF ZELF, INTERVIEW NIET. Vraagt Maarten een mail of bericht te sturen ('mail klant X dat …', 'stuur die chef een berichtje'), zoek de klant/chef dan op (clients.find / chefs.find) en roep meteen email.send_to_client / email.send_to_chef aan met een nette concept-mail die jij zelf schrijft. Je hoeft NOOIT om een e-mailadres te vragen (dat regelt de tool) en ook niet om aanhef, toon of afsluiting — die kies je zelf. Maarten ziet je concept en bevestigt één keer; dát is het enige check-moment. Stel hooguit één korte vraag als de KERN (wat moet er in de mail?) echt ontbreekt.",
  "- GEBRUIK HET GESPREK. Bouw voort op de vorige beurten. Verwijst Maarten terug of laat hij het onderwerp weg ('en hun e-mail?', 'wie daarvan?', 'en in Rotterdam dan?'), neem dan de entiteit én het onderwerp van zojuist over — ging het net over chefs, dan gaat een vervolgvraag ook over chefs, tenzij Maarten duidelijk omschakelt. Vraag alleen om opheldering als het mét het gesprek erbij écht onduidelijk blijft, en stel dan één korte, gerichte vraag (geen algemene tegenvraag over iets dat al duidelijk was).",
  "- DENK MEE, dump geen cijfers. Begin met het antwoord of het inzicht in een zin of twee — niet een rij kale getallen. Valt je iets op (een knelpunt, een nul die ergens op wijst, een kans), benoem het kort. Sluit af met de logische volgende stap als die er is ('Zal ik …?').",
  "- WEES EERLIJK met data. Gebruik alleen cijfers, namen en statussen die uit een tool komen; verzin nooit iets. Staat iets op nul of ontbreken er gegevens, leg dan kort uit wat dat waarschijnlijk betekent (bv. 'er zijn deze maand nog geen uren geregistreerd, dus de loonkosten staan op €0').",
  "- ACTIES: voor iets versturen of iets dat geld/onomkeerbaar raakt roep je de tool aan; het systeem vraagt Maarten zelf om bevestiging. Doe nooit alsof iets al gebeurd is voordat het bevestigd is.",
  "- Kun je iets écht niet (geen tool voor), zeg dat luchtig in één zin en bied meteen aan wat je WÉL kunt doen — nooit een kale weigering.",
  "- Heb je de gegevens al opgehaald? Geef dan direct antwoord; roep niet nóg een keer dezelfde tool aan.",
  "- Je kunt nooit méér dan Maarten zelf mag; het systeem dwingt dat af.",
  "",
  "Kort, menselijk, behulpzaam. Je bent z'n rechterhand, geen zoekmachine.",
].join("\n") + "\n\n---\n\n" + ASSISTANT_PLAYBOOK;

/** Token usage for one model call (prompt = input, completion = output). */
export type TokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

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
  /** Backoff (ms) per retry on transient errors (429 / 5xx). Default [400, 1200] → up to
   *  2 retries. Tests pass [0, 0] for instant retries. */
  retryDelaysMs?: number[];
  /** Called with token usage after each successful model call (feeds the usage tally). */
  onUsage?: (usage: TokenUsage) => void;
  /** Hard cap on output tokens per call — bounds cost (output is 6× input) + tail latency.
   *  Set generously; the playbook already asks for short answers. */
  maxCompletionTokens?: number;
  /** Stable cache key (e.g. per user) so OpenAI routes repeat calls to the same cache. With a
   *  byte-stable prefix (system + tools), this lifts the prompt-cache hit rate (10× cheaper input). */
  promptCacheKey?: string;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function extractApiError(json: unknown): string | null {
  const msg = (json as { error?: { message?: unknown } })?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg : null;
}

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
      if (opts.maxCompletionTokens) payload.max_completion_tokens = opts.maxCompletionTokens;
      if (opts.promptCacheKey) payload.prompt_cache_key = opts.promptCacheKey;
      const req = {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(payload),
      };
      // Resilient send: retry transient failures (429 rate-limit, 5xx) with backoff so a
      // single hiccup doesn't fail the whole turn. Other 4xx fail fast (no point retrying).
      const retryDelays = opts.retryDelaysMs ?? [400, 1200];
      let lastError = "onbekende fout";
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        const res = await transport(req);
        if (res.status >= 200 && res.status < 300) {
          if (opts.onUsage) {
            const usage = parseUsage(res.json);
            if (usage) opts.onUsage(usage);
          }
          return parseChoice(res.json);
        }
        lastError = extractApiError(res.json) ?? `status ${res.status}`;
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt < retryDelays.length) {
          await sleep(retryDelays[attempt] ?? 0);
          continue;
        }
        break;
      }
      throw new Error(`OpenAI API gaf een fout: ${lastError}`);
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
    } else if (m.role === "assistant" && (m.toolCalls?.length || m.toolCall)) {
      // the assistant's own tool-call turn (no text content) — one OR many calls (parallel)
      const refs = m.toolCalls?.length ? m.toolCalls : m.toolCall ? [m.toolCall] : [];
      out.push({
        role: "assistant",
        content: null,
        tool_calls: refs.map((r) => ({
          id: r.id,
          type: "function" as const,
          function: { name: toOpenAiName(r.name), arguments: r.arguments },
        })),
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
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/** Pull token usage out of a (non-streaming) Chat Completions response, or null if absent. */
function parseUsage(json: unknown): TokenUsage | null {
  const u = (json as OpenAiResponse).usage;
  if (!u) return null;
  const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  const totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function parseChoice(json: unknown): BrainStep {
  const msg = (json as OpenAiResponse).choices?.[0]?.message;
  const toolCalls = msg?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    // Return EVERY tool call the model batched this turn (not just the first) — the agent
    // loop runs them concurrently, saving a model round-trip per extra tool.
    const calls = toolCalls.map((tc, j) => {
      const fn = tc?.function;
      const rawArgs = typeof fn?.arguments === "string" && fn.arguments.trim() ? fn.arguments : "{}";
      let input: unknown = {};
      try {
        input = JSON.parse(rawArgs);
      } catch {
        input = {};
      }
      const dotted = fromOpenAiName(String(fn?.name ?? ""));
      return { tool: dotted, input, call: { id: String(tc?.id ?? `call_${j}`), name: dotted, arguments: rawArgs } };
    });
    return { kind: "tool_calls", calls };
  }
  return { kind: "final", text: typeof msg?.content === "string" ? msg.content : "" };
}
