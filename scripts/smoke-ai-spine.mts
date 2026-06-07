/**
 * AI runtime spine smoke — the gate (validate → permission → confirm → audit) and the
 * channel-agnostic agent loop, proven with fake tools + in-memory audit + a scripted
 * brain. No DB, no env, no LLM, no key.
 *   npx tsx scripts/smoke-ai-spine.mts
 */
import type { AiActor, AiAuditEvent, ToolContext } from "@/lib/ai/types";
import type { Brain, BrainStep, Msg } from "@/lib/ai/runtime/agent";

const { z } = await import("zod");
const { defineTool, createRegistry } = await import("@/lib/ai/tools/registry");
const { executeTool } = await import("@/lib/ai/runtime/execute");
const { runAgent } = await import("@/lib/ai/runtime/agent");
const { mintConfirmToken, hashInput } = await import("@/lib/ai/runtime/confirm-token");

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

const SECRET = "test-confirm-secret-please-ignore-0123456789";
const NOW = 1_700_000_000_000; // fixed clock so mint/verify share a window

const owner: AiActor = {
  requestedByUserId: "user_owner",
  requestedByRole: "owner",
  paServiceUserId: "user_pa",
  effectivePerms: new Set(["hours.read", "hours.approve", "notifications.send"]),
};
const limited: AiActor = { ...owner, effectivePerms: new Set(["hours.read"]) };

const ctx = (actor: AiActor, extra: Partial<ToolContext> = {}): ToolContext => ({
  actor,
  channel: "dashboard",
  ...extra,
});

function makeSink() {
  const events: AiAuditEvent[] = [];
  return { events, sink: async (e: AiAuditEvent) => void events.push(e) };
}
const opts = (sink: (e: AiAuditEvent) => Promise<void>) => ({ auditSink: sink, confirmSecret: SECRET, now: NOW });

// ── fake tools, one per relevant shape ──────────────────────────────────────
const readTool = defineTool({
  name: "fake.read",
  title: "Lees test",
  description: "leest iets",
  risk: "read",
  permission: { resource: "hours", action: "read" },
  input: z.object({ q: z.string() }),
  run: async (input) => ({ data: { rows: [input.q] }, summary: `Gelezen: ${input.q}` }),
});
const notifyTool = defineTool({
  name: "fake.notify",
  title: "Stuur herinnering",
  description: "stuurt een vriendelijke herinnering naar een chef",
  risk: "outbound",
  permission: { resource: "notifications", action: "send" },
  input: z.object({ to: z.string(), text: z.string() }),
  describeAction: (input) => `Herinnering sturen naar ${input.to}.`,
  run: async (input) => ({ data: { id: "msg_1", to: input.to }, summary: `Herinnering gestuurd naar ${input.to}.` }),
});
const approveTool = defineTool({
  name: "fake.approve",
  title: "Keur uren goed",
  description: "keurt uren goed",
  risk: "financial",
  permission: { resource: "hours", action: "approve" },
  input: z.object({ hoursId: z.string() }),
  describeAction: (input) => `Uren ${input.hoursId} goedkeuren.`,
  run: async (input) => ({ data: { id: input.hoursId }, summary: `Uren ${input.hoursId} goedgekeurd.` }),
});
const boomTool = defineTool({
  name: "fake.boom",
  title: "Faalt altijd",
  description: "gooit een fout",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async () => {
    throw new Error("kapot");
  },
});
const registry = createRegistry([readTool, notifyTool, approveTool, boomTool]);

console.log("=== AI runtime spine smoke ===\n");

console.log("── read tool: no confirmation, audited ──");
{
  const { events, sink } = makeSink();
  const r = await executeTool(readTool, { q: "wie mist uren" }, ctx(owner), opts(sink));
  assert("read → ok", r.status === "ok");
  assert("read summary present", r.status === "ok" && r.summary.includes("Gelezen"));
  assert("audited invoked + completed", events.some((e) => e.kind === "invoked") && events.some((e) => e.kind === "completed"));
  assert("never blocked", !events.some((e) => e.kind === "blocked"));
}

console.log("\n── permission ceiling ──");
{
  const { events, sink } = makeSink();
  const r = await executeTool(approveTool, { hoursId: "h1" }, ctx(limited), opts(sink));
  assert("approve without perm → denied", r.status === "denied");
  assert("blocked perm_denied audited", events.some((e) => e.kind === "blocked" && e.reason === "perm_denied"));
  assert("handler never ran", !events.some((e) => e.kind === "completed"));
}

console.log("\n── confirm gate: propose then confirm ──");
{
  const { events, sink } = makeSink();
  const input = { to: "daniel@example.nl", text: "hoi" };
  const r1 = await executeTool(notifyTool, input, ctx(owner), opts(sink));
  assert("first attempt → needs_confirmation", r1.status === "needs_confirmation");
  assert("needs_confirmation audited", events.some((e) => e.kind === "blocked" && e.reason === "needs_confirmation"));
  assert("nothing sent yet", !events.some((e) => e.kind === "completed"));
  assert("summary names the recipient", r1.status === "needs_confirmation" && r1.confirmation.summary.includes("daniel@example.nl"));
  const token = r1.status === "needs_confirmation" ? r1.confirmation.token : "";
  const r2 = await executeTool(notifyTool, input, ctx(owner, { confirmation: token }), opts(sink));
  assert("re-attempt with token → ok", r2.status === "ok");
  assert("send completed after confirm", events.some((e) => e.kind === "completed"));
}

console.log("\n── confirm gate: forgery + replay resistance ──");
{
  const { events, sink } = makeSink();
  const bad = await executeTool(notifyTool, { to: "a", text: "b" }, ctx(owner, { confirmation: "999.deadbeef" }), opts(sink));
  assert("garbage token → denied", bad.status === "denied");
  assert("bad_confirmation audited", events.some((e) => e.kind === "blocked" && e.reason === "bad_confirmation"));

  const tokenForA = mintConfirmToken({
    tool: "fake.notify",
    inputHash: hashInput({ to: "a@x.nl", text: "hi" }),
    actorUserId: owner.requestedByUserId,
    secret: SECRET,
    now: NOW,
  });
  const replay = await executeTool(notifyTool, { to: "b@x.nl", text: "hi" }, ctx(owner, { confirmation: tokenForA }), opts(makeSink().sink));
  assert("token bound to inputs — denied for a different action", replay.status === "denied");

  const wrongActor = await executeTool(
    notifyTool,
    { to: "a@x.nl", text: "hi" },
    ctx({ ...owner, requestedByUserId: "someone_else" }, { confirmation: tokenForA }),
    opts(makeSink().sink),
  );
  assert("token bound to the human — denied for a different actor", wrongActor.status === "denied");
}

console.log("\n── input validation + handler failure ──");
{
  const r = await executeTool(readTool, { q: 123 }, ctx(owner), opts(makeSink().sink));
  assert("invalid input → error", r.status === "error");

  const { events, sink } = makeSink();
  const boom = await executeTool(boomTool, {}, ctx(owner), opts(sink));
  assert("throwing handler → error", boom.status === "error");
  assert("exception audited as failed", events.some((e) => e.kind === "failed" && e.reason === "exception"));
}

console.log("\n── agent loop: pauses for confirmation ──");
{
  const script: BrainStep[] = [
    { kind: "tool_call", tool: "fake.read", input: { q: "wie heeft uren niet goedgekeurd" } },
    { kind: "tool_call", tool: "fake.notify", input: { to: "daniel@example.nl", text: "vriendelijke herinnering" } },
    { kind: "final", text: "klaar" },
  ];
  const brain: Brain = { plan: async () => script.shift() ?? { kind: "final", text: "(leeg)" } };
  const outcome = await runAgent({
    brain,
    registry,
    messages: [{ role: "user", content: "wie mist goedkeuring, stuur ze een herinnering" }],
    ctx: ctx(owner),
    executeOptions: opts(makeSink().sink),
  });
  assert("agent pauses → awaiting_confirmation", outcome.kind === "awaiting_confirmation");
  assert("paused on the outbound tool", outcome.kind === "awaiting_confirmation" && outcome.confirmation.tool === "fake.notify");
  assert("read ran ok before the pause", outcome.steps.length === 2 && outcome.steps[0]?.result.status === "ok");
}

console.log("\n── agent loop: resumes when pre-confirmed ──");
{
  const notifyInput = { to: "daniel@example.nl", text: "vriendelijke herinnering" };
  const token = mintConfirmToken({
    tool: "fake.notify",
    inputHash: hashInput(notifyInput),
    actorUserId: owner.requestedByUserId,
    secret: SECRET,
    now: NOW,
  });
  const script: BrainStep[] = [
    { kind: "tool_call", tool: "fake.notify", input: notifyInput },
    { kind: "final", text: "herinnering verstuurd" },
  ];
  const brain: Brain = { plan: async () => script.shift() ?? { kind: "final", text: "(leeg)" } };
  const outcome = await runAgent({
    brain,
    registry,
    messages: [{ role: "user", content: "stuur daniel de herinnering" }],
    ctx: ctx(owner, { confirmation: token }),
    executeOptions: opts(makeSink().sink),
  });
  assert("pre-confirmed agent reaches final", outcome.kind === "final");
  assert("final text from the brain", outcome.kind === "final" && outcome.text === "herinnering verstuurd");
}

console.log("\n── agent loop: tool DATA (not just the summary) is fed back to the brain ──");
{
  let lastSeen: Msg[] = [];
  const script: BrainStep[] = [
    { kind: "tool_call", tool: "fake.read", input: { q: "tel de chefs" } },
    { kind: "final", text: "klaar" },
  ];
  const brain: Brain = {
    plan: async ({ messages }) => {
      lastSeen = messages;
      return script.shift() ?? { kind: "final", text: "(leeg)" };
    },
  };
  await runAgent({
    brain,
    registry,
    messages: [{ role: "user", content: "hoeveel chefs" }],
    ctx: ctx(owner),
    executeOptions: opts(makeSink().sink),
  });
  const toolMsg = lastSeen.find((m) => m.role === "tool");
  assert("tool result is fed back to the brain", Boolean(toolMsg));
  assert(
    "fed-back message carries the STRUCTURED data, not just the summary (regression: 'maximum aantal stappen')",
    Boolean(toolMsg && toolMsg.content.includes('"rows"')),
  );
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
