/**
 * WhatsApp (sent.dm) sender smoke — request shape + success/error parsing, no network.
 *   npx tsx --env-file=.env.local scripts/smoke-whatsapp.mts
 * The happy/error paths need SENT_DM_API_KEY set (mock transport, so no real send); the
 * input-validation paths are key-free.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { sendWhatsApp } = await import("@/lib/whatsapp");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== WhatsApp (sent.dm) sender ===\n");

console.log("── input validation (key-free) ──");
assert("no recipient → error", !(await sendWhatsApp({ to: [], template: { name: "x" } })).ok);
assert("bad phone (not E.164) → error", !(await sendWhatsApp({ to: ["0612345678"], template: { name: "x" } })).ok);
assert("missing template → error", !(await sendWhatsApp({ to: ["+31612345678"], template: {} })).ok);

console.log("\n── request shape + success parsing (mock transport) ──");
let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
const okTransport = async (req: { url: string; headers: Record<string, string>; body: string }) => {
  captured = req;
  return {
    status: 202,
    json: {
      success: true,
      data: {
        status: "QUEUED",
        recipients: [{ message_id: "msg_123", to: "+31612345678", channel: "whatsapp" }],
      },
      meta: { request_id: "req_abc" },
    },
  };
};
const okRes = await sendWhatsApp({
  to: ["+31612345678"],
  template: { name: "uren_herinnering", parameters: { naam: "Lisa" } },
  sandbox: true,
  transport: okTransport,
});

if (!okRes.ok) {
  assert("happy path returns ok", false, okRes.error);
} else {
  assert("happy path returns ok", true);
  assert("status QUEUED", okRes.status === "QUEUED");
  assert("messageId parsed", okRes.recipients[0]?.messageId === "msg_123");
  assert("requestId parsed", okRes.requestId === "req_abc");
}
assert("POSTs to /v3/messages", !!captured && (captured as { url: string }).url.endsWith("/v3/messages"));
assert("sends x-api-key header", !!captured && typeof (captured as { headers: Record<string, string> }).headers["x-api-key"] === "string");
{
  const b = captured ? JSON.parse((captured as { body: string }).body) : {};
  assert("body has E.164 recipient", Array.isArray(b.to) && b.to[0] === "+31612345678");
  assert("body channel defaults to whatsapp", Array.isArray(b.channel) && b.channel.includes("whatsapp"));
  assert("body carries template + params", b.template?.name === "uren_herinnering" && b.template?.parameters?.naam === "Lisa");
  assert("body passes sandbox flag", b.sandbox === true);
}

console.log("\n── error parsing (mock transport) ──");
const errRes = await sendWhatsApp({
  to: ["+31612345678"],
  template: { name: "x" },
  transport: async () => ({
    status: 400,
    json: { success: false, error: { code: "VALIDATION_004", message: "Request validation failed" } },
  }),
});
assert("error path returns !ok", !errRes.ok);
assert("error code surfaced", !errRes.ok && errRes.code === "VALIDATION_004");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
