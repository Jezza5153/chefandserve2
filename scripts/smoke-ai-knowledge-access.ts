/**
 * Execution smoke: can the assistant actually REACH the migrated knowledge without
 * embeddings? (dev DB, throwaway rows, cleaned up on failure too)
 *
 *   npx tsx --env-file=.env.local scripts/smoke-ai-knowledge-access.ts
 *
 * Guards the exact failure this batch fixes: with an empty/blocked embedding corpus the
 * assistant used to answer "kennisbank niet beschikbaar" while the notes sat in Postgres.
 * The routing eval never executes a tool, so only running it proves the path works —
 * and it also proves the AVG contract (PII redacted before the text leaves the tool).
 */
export {}; // module-marker: zonder top-level import ziet tsc dit als globaal script

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes("ep-icy-scene")) {
    console.error("REFUSING: smoke creates throwaway rows — dev only.");
    process.exit(2);
  }

  const { db } = await import("@/lib/db/client");
  const { chefs, clients } = await import("@/lib/db/schema");
  const { searchKnowledgeByKeyword } = await import("@/lib/ai/read-model/knowledge-keyword");
  const { chefsDossier, clientsDossier } = await import("@/lib/ai/tools/dossier");
  const { eq } = await import("drizzle-orm");

  let pass = 0;
  let fail = 0;
  const ok = (name: string, cond: boolean, extra?: unknown) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`, extra ?? ""); }
  };

  const tag = `Zwaanshoekfictief${Date.now()}`;
  const chefNotes = [
    "═══ Oud systeem (ShiftManager, overgezet 2026-07-27) ═══",
    "Historie oud systeem: 155 uitnodigingen · ±1149 uur gewerkt",
    `• 2025-10-22 (Helena): Werkte veel bij ${tag}. Bereikbaar op 0612345678 of test.smoke@example.com. Tarief €32,50.`,
  ].join("\n");

  const [chef] = await db
    .insert(chefs)
    .values({ fullName: `SMOKE Kennis Chef ${Date.now()}`, status: "active", notes: chefNotes })
    .returning({ id: chefs.id, name: chefs.fullName });
  const [klant] = await db
    .insert(clients)
    .values({
      companyName: `SMOKE Kennis Klant ${Date.now()}`,
      status: "active",
      notes: `Blacklist (oud): Jan Jansen — kwam niet opdagen. Briefing: eigen messen mee. Contact 0687654321.`,
    })
    .returning({ id: clients.id, name: clients.companyName });

  try {
    // 1. keyword fallback finds the chef by something only the NOTES contain
    const hits = await searchKnowledgeByKeyword(tag, 10);
    ok("trefwoord-zoek vindt de chef op een woord uit de notitie", hits.some((h) => h.source === `chefs:${chef.id}`), hits.map((h) => h.source));

    // 2. the snippet is redacted — no phone/e-mail may reach the model
    const snip = hits.find((h) => h.source === `chefs:${chef.id}`)?.snippet ?? "";
    ok("snippet bevat géén telefoonnummer", !/0612345678/.test(snip), snip);
    ok("snippet bevat géén e-mailadres", !/test\.smoke@example\.com/.test(snip), snip);

    // 3. dossier tool returns the notes directly (no index involved)
    const ctx = { actor: { requestedByUserId: "smoke" } } as never;
    const d = (await chefsDossier.run({ chefId: chef.id }, ctx)) as { data: { notes: string }; summary: string };
    ok("chefs.dossier geeft de notitie terug", d.data.notes.includes("Historie oud systeem"), d.data.notes.slice(0, 80));
    ok("chefs.dossier redigeert telefoonnummer", !/0612345678/.test(d.data.notes));
    ok("chefs.dossier behoudt het tarief (geen over-redactie)", /32,50/.test(d.data.notes));

    const k = (await clientsDossier.run({ clientId: klant.id }, ctx)) as { data: { notes: string } };
    ok("clients.dossier geeft blacklist-reden terug", /kwam niet opdagen/.test(k.data.notes), k.data.notes.slice(0, 80));

    // 4. an unknown id must fail loudly, not silently return nothing
    let threw = false;
    try {
      await chefsDossier.run({ chefId: "00000000-0000-0000-0000-000000000000" }, ctx);
    } catch { threw = true; }
    ok("onbekende chefId → duidelijke fout", threw);
  } finally {
    await db.delete(chefs).where(eq(chefs.id, chef.id));
    await db.delete(clients).where(eq(clients.id, klant.id));
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
