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
              tool_calls: [{ function: { name: "hours.approve", arguments: JSON.stringify({ hoursId: "h1" }) } }],
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
  assert("tool name parsed", step.kind === "tool_call" && step.tool === "hours.approve");
  assert("arguments parsed", step.kind === "tool_call" && (step.input as { hoursId?: string }).hoursId === "h1");
  assert("request carried the tool", capturedBody.includes("hours.approve"));
  assert("request carried the system prompt", capturedBody.includes("Maarten"));
  assert("request set tool_choice", capturedBody.includes("tool_choice"));
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

console.log("\n── brain: API error ──");
{
  const transport: OpenAiTransport = async () => ({ status: 500, json: {} });
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport });
  let threw = false;
  try {
    await brain.plan({ messages: [], tools: [] });
  } catch {
    threw = true;
  }
  assert("non-2xx throws", threw);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
