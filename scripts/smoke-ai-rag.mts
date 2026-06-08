/**
 * RAG foundation smoke — PII redaction (every pattern, per the contract's pre-flight) +
 * chunking. Pure functions, no DB / no network.
 *   npx tsx scripts/smoke-ai-rag.mts
 */
const { redact, isPiiDense, REDACTION_VERSION } = await import("@/lib/ai/rag/redact");
const { chunkText } = await import("@/lib/ai/rag/chunk");

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

console.log("=== RAG foundation smoke ===\n");

console.log("── redaction: every pattern ──");
assert("email", redact("mail jan@example.nl nu").text === "mail <email> nu");
assert("NL phone +31", redact("bel +31612345678 svp").text === "bel <phone> svp");
assert("NL phone 06", redact("06-12345678").text === "<phone>");
assert("IBAN", redact("rek NL91ABNA0417164300 ok").text === "rek <iban> ok");
assert("16-digit card", redact("kaart 4111111111111111 x").text === "kaart <card> x");
assert("BSN (9 digits)", redact("bsn 123456789 hier").text === "bsn <bsn> hier");
assert("DOB DD-MM-YYYY", redact("geboren 05-11-1990 te NL").text === "geboren <dob> te NL");
assert("clean text untouched", redact("ervaren sous-chef, fine dining, houdt van events").text === "ervaren sous-chef, fine dining, houdt van events");
assert("count tracks replacements", redact("a@b.nl en c@d.nl").redactedCount === 2);

console.log("\n── PII density gate ──");
assert("dense PII → skip", isPiiDense("123456789 987654321", redact("123456789 987654321")));
{
  const t = "ervaren chef de partie met veel keukenervaring in fine dining en hotels";
  assert("sparse/clean → keep", !isPiiDense(t, redact(t)));
}
assert("redaction version is set", typeof REDACTION_VERSION === "number" && REDACTION_VERSION >= 1);

console.log("\n── chunking ──");
assert("empty → 0 chunks", chunkText("   ").length === 0);
assert("short → 1 chunk", chunkText("kort stukje tekst").length === 1);
{
  const long = Array.from({ length: 24 }, (_, i) => `Paragraaf ${i}. ${"vakmanschap ".repeat(30)}`).join("\n\n");
  const chunks = chunkText(long);
  assert("long text → multiple chunks", chunks.length > 1, `got ${chunks.length}`);
  assert("every chunk under hard cap", chunks.every((c) => c.length <= 4200));
  assert("chunks are non-empty", chunks.every((c) => c.trim().length > 0));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
