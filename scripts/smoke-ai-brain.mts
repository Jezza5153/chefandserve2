/**
 * AI brain smoke — the zod→JSON-schema converter and the OpenAI brain adapter, proven
 * with an injected fake transport (no SDK, no key, no network).
 *   npx tsx scripts/smoke-ai-brain.mts
 */
import type { OpenAiTransport } from "@/lib/ai/runtime/openai-brain";
import type { ToolSpec } from "@/lib/ai/tools/registry";

const { z } = await import("zod");
const { zodToJsonSchema } = await import("@/lib/ai/runtime/zod-schema");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

console.log("=== AI brain smoke ===\n");

console.log("── zod → JSON schema ──");
{
  const empty = zodToJsonSchema(z.object({}));
  assert("empty object → type object", empty.type === "object");

  const one = zodToJsonSchema(z.object({ hoursId: z.string() }));
  const req = (one.required as string[]) ?? [];
  assert("required field listed", req.includes("hoursId"));
  assert("string prop typed", (one.properties as Record<string, { type?: string }>).hoursId?.type === "string");

  const opt = zodToJsonSchema(z.object({ n: z.number().optional() }));
  const optReq = (opt.required as string[]) ?? [];
  assert("optional field not required", !optReq.includes("n"));
  assert("number prop typed", (opt.properties as Record<string, { type?: string }>).n?.type === "number");

  const en = zodToJsonSchema(z.enum(["a", "b"]));
  assert("enum → string + values", en.type === "string" && (en.enum as string[]).length === 2);
}

console.log("\n── brain: tool_call response ──");
{
  let capturedBody = "";
  const transport: OpenAiTransport = async (req) => {
    capturedBody = req.body;
    return {
      status: 200,
      json: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ function: { name: "hours__approve", arguments: JSON.stringify({ hoursId: "h1" }) } }],
            },
          },
        ],
      },
    };
  };
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport });
  const tools: ToolSpec[] = [
    {
      name: "hours.approve",
      title: "Uren goedkeuren",
      description: "keurt uren goed",
      risk: "financial",
      parameters: { type: "object", properties: { hoursId: { type: "string" } }, required: ["hoursId"] },
    },
  ];
  const step = await brain.plan({ messages: [{ role: "user", content: "keur h1 goed" }], tools });
  assert("returns tool_call", step.kind === "tool_call");
  assert("tool name un-mapped back to dotted id", step.kind === "tool_call" && step.tool === "hours.approve");
  assert("arguments parsed", step.kind === "tool_call" && (step.input as { hoursId?: string }).hoursId === "h1");
  assert("request carried the DOTLESS tool name (OpenAI rejects dots)", capturedBody.includes("hours__approve"));
  assert("request did NOT send a dotted name", !capturedBody.includes('"hours.approve"'));
  assert("request carried the system prompt", capturedBody.includes("Maarten"));
  assert("request carried the playbook (domain knowledge)", capturedBody.includes("vakniveau"));
  assert("request set tool_choice", capturedBody.includes("tool_choice"));
}

console.log("\n── brain: threads prior turns + carries context guidance ──");
{
  let capturedBody = "";
  const transport: OpenAiTransport = async (req) => {
    capturedBody = req.body;
    return { status: 200, json: { choices: [{ message: { content: "ok" } }] } };
  };
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport });
  await brain.plan({
    messages: [
      { role: "user", content: "hoeveel chefs heb ik" },
      { role: "assistant", content: "Je hebt nu 8 actieve chefs op de rol." },
      { role: "user", content: "wie heeft er een email adres" },
    ],
    tools: [],
  });
  const body = JSON.parse(capturedBody) as { messages: Array<{ role: string; content: string | null }> };
  // Regression guard for "the assistant forgot the context": every prior turn — including
  // the previous assistant answer — must reach the model, and the system prompt must tell
  // it to build on the conversation.
  assert("prior user turn reaches the model", body.messages.some((m) => m.role === "user" && m.content === "hoeveel chefs heb ik"));
  assert(
    "prior assistant answer reaches the model (context kept)",
    body.messages.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("8 actieve chefs")),
  );
  assert("follow-up question reaches the model", body.messages.some((m) => m.role === "user" && m.content === "wie heeft er een email adres"));
  assert("system prompt instructs using the conversation", capturedBody.includes("GEBRUIK HET GESPREK"));
}

console.log("\n── brain: final-answer response ──");
{
  const transport: OpenAiTransport = async () => ({
    status: 200,
    json: { choices: [{ message: { content: "Er wachten 3 urenregels op je goedkeuring." } }] },
  });
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport });
  const step = await brain.plan({ messages: [{ role: "user", content: "hoeveel?" }], tools: [] });
  assert("returns final", step.kind === "final");
  assert("final text passed through", step.kind === "final" && step.text.includes("3 urenregels"));
}

console.log("\n── brain: transient-error retry ──");
{
  let calls = 0;
  const transport: OpenAiTransport = async () => {
    calls++;
    return calls < 3
      ? { status: 503, json: { error: { message: "overloaded" } } }
      : { status: 200, json: { choices: [{ message: { content: "ok na retry" } }] } };
  };
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport, retryDelaysMs: [0, 0] });
  const step = await brain.plan({ messages: [], tools: [] });
  assert("retries transient 5xx then succeeds", step.kind === "final" && step.text === "ok na retry");
  assert("retried exactly until success (3 calls)", calls === 3);
}

console.log("\n── brain: non-transient error fails fast with API message ──");
{
  let calls = 0;
  const transport: OpenAiTransport = async () => {
    calls++;
    return { status: 400, json: { error: { message: "bad request body" } } };
  };
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport, retryDelaysMs: [0, 0] });
  let msg = "";
  try {
    await brain.plan({ messages: [], tools: [] });
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert("4xx throws", msg.length > 0);
  assert("4xx surfaces the real API message", msg.includes("bad request body"));
  assert("4xx is not retried (1 call)", calls === 1);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
