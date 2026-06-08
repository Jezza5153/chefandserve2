/**
 * RAG foundation smoke — PII redaction (every pattern, per the contract's pre-flight) +
 * chunking. Pure functions, no DB / no network.
 *   npx tsx scripts/smoke-ai-rag.mts
 */
const { redact, isPiiDense, REDACTION_VERSION } = await import("@/lib/ai/rag/redact");
const { chunkText, chunkMarkdown } = await import("@/lib/ai/rag/chunk");
const { accessFilterFor, tenantScopesForSubject } = await import("@/lib/ai/rag/access");

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

console.log("\n── markdown chunking (project docs) ──");
{
  const md = "# Titel\n\nIntro.\n\n## Sectie A\n\nInhoud A.\n\n### Sub A1\n\nDetail A1.\n\n## Sectie B\n\nInhoud B.";
  const secs = chunkMarkdown(md);
  assert("markdown → multiple sections", secs.length >= 3, `got ${secs.length}`);
  assert("heading breadcrumb carries parent", secs.some((s) => s.heading === "Titel › Sectie A › Sub A1"));
  assert("section text is heading-prefixed", secs.some((s) => s.text.startsWith("Titel › Sectie A: ")));
  assert("empty markdown → 0 sections", chunkMarkdown("   ").length === 0);
}

console.log("\n── access filter: tenant_scope + visibility (the no-cross-tenant-leak guarantee) ──");
{
  const internal = accessFilterFor({ kind: "internal" });
  assert("internal spans all tenants (scopes=null)", internal.tenantScopes === null);
  assert("internal sees admin_only", internal.visibilities.includes("admin_only"));
  assert("internal (non-super) does NOT see super_admin_only", !internal.visibilities.includes("super_admin_only"));
  assert("super_admin sees super_admin_only", accessFilterFor({ kind: "internal", superAdmin: true }).visibilities.includes("super_admin_only"));

  const chefA = accessFilterFor({ kind: "chef", entityId: "A", placementIds: ["p1"] });
  assert("chef scoped to self", chefA.tenantScopes?.includes("chefId:A") === true);
  assert("chef gets public scope", chefA.tenantScopes?.includes("public") === true);
  assert("chef gets placement bridge", chefA.tenantScopes?.includes("placement:p1") === true);
  assert("chef NOT scoped to internal", !chefA.tenantScopes?.includes("internal"));
  assert("chef does NOT see another chef", !chefA.tenantScopes?.includes("chefId:B"));
  assert("chef does NOT see admin_only", !chefA.visibilities.includes("admin_only"));
  assert("chef does NOT see klant chunks", !chefA.visibilities.includes("klant_own_and_admin"));
  assert("chef sees own + bridge", chefA.visibilities.includes("chef_own_and_admin") && chefA.visibilities.includes("placement_bridge"));

  const client = accessFilterFor({ kind: "client", entityId: "C" });
  assert("klant scoped to self", client.tenantScopes?.includes("clientId:C") === true);
  assert("klant does NOT see admin_only", !client.visibilities.includes("admin_only"));
  assert("klant does NOT see chef chunks", !client.visibilities.includes("chef_own_and_admin"));
  assert("klant sees own + bridge", client.visibilities.includes("klant_own_and_admin") && client.visibilities.includes("placement_bridge"));
}

console.log("\n── AVG purge: tenant_scopes for an erased subject ──");
{
  assert("chef erasure → chefId scope", JSON.stringify(tenantScopesForSubject({ chefId: "A" })) === '["chefId:A"]');
  assert("klant erasure → clientId scope", JSON.stringify(tenantScopesForSubject({ clientId: "C" })) === '["clientId:C"]');
  assert("both ids → both scopes", tenantScopesForSubject({ chefId: "A", clientId: "C" }).length === 2);
  assert("no ids → no scopes (no-op purge)", tenantScopesForSubject({}).length === 0);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
