/**
 * Invoicing (facturatie) smoke — proves the klant-billing core is correct +
 * properly wired:
 *   - generateInvoiceForPeriod bills ONLY admin_approved hours whose shift falls
 *     in the period, with correct line math + 21% BTW, and is IDEMPOTENT.
 *   - already-invoiced + out-of-range + not-approved hours are never billed.
 *   - voidInvoice frees the period (partial unique index) AND re-frees its hours.
 *   - markInvoicePaid only fires sent→paid; sendInvoice guards no-recipient +
 *     not-sendable (void/paid). NO real email is sent (client has no address).
 *
 *     npx tsx scripts/smoke-invoicing.mts
 *
 * Throwaway user/client/chef/shifts/hours, all MARKed + torn down in finally.
 * Needs DB env (.env.local = dev branch).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const {
  generateInvoiceForPeriod,
  sendInvoice,
  markInvoicePaid,
  voidInvoice,
  getUnbilledHoursByClient,
} = await import("@/lib/domain/invoicing");
const { chefs, clients, invoiceLines, invoices, placements, shiftHours, shifts, users } =
  await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

const MARK = `INVOICE_SMOKE_${crypto.randomUUID()}`;
const HOUR = 3_600_000;

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

let actorUserId = "";
let clientId = "";
let chefId = "";

/** Create one billable unit: a shift + completed placement + shift_hours row. */
async function makeHours(opts: {
  startsAt: Date;
  workedMinutes: number;
  clientRateCents: number;
  status?: "admin_approved" | "client_signed";
}): Promise<string> {
  const [s] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 4 * HOUR),
      roleNeeded: "chef_de_partie",
      headcount: 1,
      status: "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  const [p] = await db
    .insert(placements)
    .values({ shiftId: s.id, chefId, status: "completed" })
    .returning({ id: placements.id });
  const [h] = await db
    .insert(shiftHours)
    .values({
      placementId: p.id,
      shiftId: s.id,
      chefId,
      clientId,
      startedAt: opts.startsAt,
      endedAt: new Date(opts.startsAt.getTime() + opts.workedMinutes * 60_000),
      breakMinutes: 0,
      workedMinutes: opts.workedMinutes,
      chefRateCents: 3000,
      clientRateCents: opts.clientRateCents,
      status: opts.status ?? "admin_approved",
      adminApprovedAt: new Date(),
    })
    .returning({ id: shiftHours.id });
  return h.id;
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

try {
  console.log("=== invoicing (facturatie) smoke ===\n");

  const [u] = await db
    .insert(users)
    .values({ email: `${MARK}@smoke.invalid`.toLowerCase() })
    .returning({ id: users.id });
  actorUserId = u.id;
  // No email / billingEmail → recipientsForClient returns [] → sendInvoice never mails.
  const [cl] = await db
    .insert(clients)
    .values({ companyName: `${MARK} Hotel BV`, kvk: "12345678", btw: "NL0012B01" })
    .returning({ id: clients.id });
  clientId = cl.id;
  const [ch] = await db
    .insert(chefs)
    .values({ fullName: `${MARK} Chef`, status: "active" })
    .returning({ id: chefs.id });
  chefId = ch.id;

  // Period P1 = 2099-03-02 … 2099-03-08 (inclusive). Two approved units in it.
  await makeHours({ startsAt: d("2099-03-03"), workedMinutes: 240, clientRateCents: 5000 }); // 4h × €50 = €200
  await makeHours({ startsAt: d("2099-03-05"), workedMinutes: 300, clientRateCents: 4000 }); // 5h × €40 = €200
  // Noise: approved but OUTSIDE P1, and inside P1 but NOT approved → both excluded.
  await makeHours({ startsAt: d("2099-03-20"), workedMinutes: 600, clientRateCents: 9999 });
  await makeHours({ startsAt: d("2099-03-04"), workedMinutes: 600, clientRateCents: 9999, status: "client_signed" });

  // Unbilled worklist (the fn is global → filter to our throwaway client).
  const u0 = (await getUnbilledHoursByClient()).find((u) => u.clientId === clientId);
  assert("unbilled: 3 approved hours waiting (client_signed excluded)", u0?.hoursCount === 3, JSON.stringify(u0));
  assert("unbilled: total = 139990c", u0?.totalCents === 139990, `=${u0?.totalCents}`);
  assert(
    "unbilled: span 2099-03-03 … 2099-03-20",
    u0?.oldestShiftDate === "2099-03-03" && u0?.newestShiftDate === "2099-03-20",
    JSON.stringify(u0),
  );

  const P1 = { periodStart: d("2099-03-02"), periodEnd: d("2099-03-08") };

  // 1. Generate P1.
  const g1 = await generateInvoiceForPeriod({ clientId, ...P1, actorUserId });
  assert("generate P1 → created", g1.ok && g1.status === "created", JSON.stringify(g1));
  if (!g1.ok || g1.status !== "created") throw new Error("P1 generation failed — abort");

  assert("P1 bills exactly 2 lines (noise excluded)", g1.lineCount === 2, `lineCount=${g1.lineCount}`);
  assert("P1 subtotal = €400,00 (40000c)", g1.subtotalCents === 40000, `subtotal=${g1.subtotalCents}`);
  assert("P1 btw 21% = €84,00 (8400c)", g1.vatCents === 8400, `vat=${g1.vatCents}`);
  assert("P1 total = €484,00 (48400c)", g1.totalCents === 48400, `total=${g1.totalCents}`);
  assert("P1 number is YYYY-NNNN", /^\d{4}-\d{4}$/.test(g1.number), g1.number);

  const linesInDb = await db
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, g1.invoiceId));
  assert("P1 wrote 2 invoice_lines rows", linesInDb.length === 2, `rows=${linesInDb.length}`);

  // 2. Idempotency.
  const g1b = await generateInvoiceForPeriod({ clientId, ...P1, actorUserId });
  assert(
    "generate P1 again → exists (same id)",
    g1b.ok && g1b.status === "exists" && g1b.invoiceId === g1.invoiceId,
    JSON.stringify(g1b),
  );

  // Invoiced hours leave the worklist (only the out-of-period 03-20 remains).
  const u1 = (await getUnbilledHoursByClient()).find((u) => u.clientId === clientId);
  assert("unbilled drops to 1 after invoicing P1's 2 hours", u1?.hoursCount === 1, JSON.stringify(u1));

  // 3. Void frees the period AND its hours.
  const v1 = await voidInvoice({ invoiceId: g1.invoiceId, actorUserId, reason: "smoke void" });
  assert("void P1 invoice → ok", v1.ok, JSON.stringify(v1));
  const [voided] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, g1.invoiceId));
  assert("voided invoice status = void", voided?.status === "void", voided?.status);

  const g1c = await generateInvoiceForPeriod({ clientId, ...P1, actorUserId });
  assert(
    "regenerate P1 after void → created (NEW invoice)",
    g1c.ok && g1c.status === "created" && g1c.invoiceId !== g1.invoiceId,
    JSON.stringify(g1c),
  );
  assert(
    "re-billed the same 2 hours (void re-freed them)",
    g1c.ok && g1c.status === "created" && g1c.lineCount === 2,
    JSON.stringify(g1c),
  );
  const liveInvoiceId = g1c.ok && g1c.status === "created" ? g1c.invoiceId : "";

  // 4. Pay-state machine. A draft can't be paid; only sent→paid; not twice.
  const payDraft = await markInvoicePaid({ invoiceId: liveInvoiceId, actorUserId });
  assert("markPaid on draft → rejected", !payDraft.ok, JSON.stringify(payDraft));
  await db.update(invoices).set({ status: "sent", sentAt: new Date() }).where(eq(invoices.id, liveInvoiceId));
  const payOk = await markInvoicePaid({ invoiceId: liveInvoiceId, actorUserId });
  assert("markPaid on sent → ok", payOk.ok, JSON.stringify(payOk));
  const payAgain = await markInvoicePaid({ invoiceId: liveInvoiceId, actorUserId });
  assert("markPaid again → rejected (already paid)", !payAgain.ok, JSON.stringify(payAgain));

  // 5. sendInvoice guards (no real mail — client has no address).
  // Fresh period P2 with 1 approved unit → a clean draft.
  await makeHours({ startsAt: d("2099-04-02"), workedMinutes: 120, clientRateCents: 6000 }); // 2h × €60 = €120
  const P2 = { periodStart: d("2099-04-01"), periodEnd: d("2099-04-07") };
  const g2 = await generateInvoiceForPeriod({ clientId, ...P2, actorUserId });
  assert("generate P2 → created", g2.ok && g2.status === "created", JSON.stringify(g2));
  const p2Id = g2.ok && g2.status === "created" ? g2.invoiceId : "";

  const sendNoRcpt = await sendInvoice({ invoiceId: p2Id, actorUserId });
  assert("send with no recipient → rejected", !sendNoRcpt.ok, JSON.stringify(sendNoRcpt));
  const [p2Still] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, p2Id));
  assert("failed send leaves invoice in draft", p2Still?.status === "draft", p2Still?.status);

  await voidInvoice({ invoiceId: p2Id, actorUserId });
  const sendVoided = await sendInvoice({ invoiceId: p2Id, actorUserId });
  assert("send a voided invoice → not_sendable", !sendVoided.ok, JSON.stringify(sendVoided));

  // 6. Empty period.
  const gEmpty = await generateInvoiceForPeriod({
    clientId,
    periodStart: d("2099-06-01"),
    periodEnd: d("2099-06-07"),
    actorUserId,
  });
  assert("empty period → status empty", gEmpty.ok && gEmpty.status === "empty", JSON.stringify(gEmpty));

  // 7. Rounding — 50 min × €50/u = €41,67 (4167c); btw 875c; total 5042c.
  await makeHours({ startsAt: d("2099-05-02"), workedMinutes: 50, clientRateCents: 5000 });
  const gRound = await generateInvoiceForPeriod({
    clientId,
    periodStart: d("2099-05-01"),
    periodEnd: d("2099-05-07"),
    actorUserId,
  });
  assert(
    "rounding: subtotal = 4167c",
    gRound.ok && gRound.status === "created" && gRound.subtotalCents === 4167,
    JSON.stringify(gRound),
  );
  assert(
    "rounding: btw = 875c, total = 5042c",
    gRound.ok && gRound.status === "created" && gRound.vatCents === 875 && gRound.totalCents === 5042,
    JSON.stringify(gRound),
  );

  // 8. Double-bill guard — P1's hours sit on the (paid) liveInvoiceId. A WIDER,
  //    overlapping period must bill them again → nothing new → empty.
  const gWide = await generateInvoiceForPeriod({
    clientId,
    periodStart: d("2099-03-01"),
    periodEnd: d("2099-03-10"),
    actorUserId,
  });
  assert("already-invoiced hours excluded → empty", gWide.ok && gWide.status === "empty", JSON.stringify(gWide));

  // 9. Void a PAID invoice → rejected (a credit note is the correct correction).
  const voidPaid = await voidInvoice({ invoiceId: liveInvoiceId, actorUserId });
  assert("void a paid invoice → rejected", !voidPaid.ok, JSON.stringify(voidPaid));

  // 10. sendInvoice happy-path — Resend's simulator address (never a real inbox).
  //     Resilient: if mail isn't configured in this env, the path is skipped.
  await db.update(clients).set({ billingEmail: "delivered@resend.dev" }).where(eq(clients.id, clientId));
  await makeHours({ startsAt: d("2099-07-02"), workedMinutes: 240, clientRateCents: 5000 });
  const gSend = await generateInvoiceForPeriod({
    clientId,
    periodStart: d("2099-07-01"),
    periodEnd: d("2099-07-07"),
    actorUserId,
  });
  const sendId = gSend.ok && gSend.status === "created" ? gSend.invoiceId : "";
  const sent = await sendInvoice({ invoiceId: sendId, actorUserId });
  if (sent.ok) {
    assert("send happy-path → ok, 1 recipient", sent.recipientCount === 1, JSON.stringify(sent));
    const [after] = await db
      .select({ status: invoices.status, sentAt: invoices.sentAt })
      .from(invoices)
      .where(eq(invoices.id, sendId));
    assert(
      "send flips draft→sent + stamps sentAt",
      after?.status === "sent" && after?.sentAt != null,
      JSON.stringify(after),
    );
    const paid2 = await markInvoicePaid({ invoiceId: sendId, actorUserId });
    assert("sent → paid", paid2.ok, JSON.stringify(paid2));
  } else {
    console.log("  ⚠ send happy-path skipped (mail not configured):", sent.error);
  }

  // 11. Every issued number is unique + well-formed YYYY-NNNN.
  const allNumbers = await db
    .select({ number: invoices.number })
    .from(invoices)
    .where(eq(invoices.clientId, clientId));
  const nums = allNumbers.map((r) => r.number);
  assert("all invoice numbers well-formed", nums.every((n) => /^\d{4}-\d{4}$/.test(n)), nums.join(","));
  assert("all invoice numbers unique", new Set(nums).size === nums.length, nums.join(","));
} finally {
  // Teardown — FK-safe order.
  if (clientId) {
    await db.delete(invoices).where(eq(invoices.clientId, clientId)); // cascades invoice_lines
    await db.delete(shiftHours).where(eq(shiftHours.clientId, clientId)); // before placements (restrict)
  }
  if (chefId) await db.delete(placements).where(eq(placements.chefId, chefId));
  if (clientId) await db.delete(shifts).where(eq(shifts.clientId, clientId));
  if (chefId) await db.delete(chefs).where(eq(chefs.id, chefId));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (actorUserId) await db.delete(users).where(eq(users.id, actorUserId));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
