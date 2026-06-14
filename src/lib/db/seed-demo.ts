/**
 * Demo seed — sample chefs, clients, shifts so the cockpit pages look
 * alive when testing locally or on a preview env.
 *
 * Run with: npm run db:seed:demo
 *
 * NEVER auto-runs in production. Guards against running unless the
 * connection string clearly points at a non-prod branch (matches
 * "/dev" or "/branch" in the URL), unless --force is passed.
 *
 * Idempotency: every demo row carries a constant marker in `notes`
 * (`DEMO_MARKER`). Re-running deletes-by-marker first, then re-inserts.
 * Real (non-demo) records are never touched.
 */

import { config } from "dotenv";
import { eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

import { chefs, clients, clientSubmissions, placements, ratings, shiftHourCorrections, shiftHours, shifts, users } from "./schema";

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL required");

const force = process.argv.includes("--force");
if (!force && !/dev|preview|branch|localhost/i.test(DB_URL)) {
  console.error(
    "\n⛔ Demo seed refused: DATABASE_URL does not look like a dev branch.\n" +
      "   Pass --force if you really mean it.\n",
  );
  process.exit(1);
}

const dbClient = drizzle(neon(DB_URL));

const DEMO_MARKER = "[demo-fixture]";

/* ----- Amsterdam date helpers (for the rich roster spread) --------------- */
const AMS_OFFSET = 2; // CEST (summer); demo data only, exactness not critical
const todayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const monthPrefix = todayKey.slice(0, 7);
function addDays(key: string, n: number): string {
  const [y, mo, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
/** A Date at the given Amsterdam wall-clock hour on `dayKey`. */
function at(dayKey: string, h: number, m = 0): Date {
  const [y, mo, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - AMS_OFFSET, m));
}
const monthDay = (d: number) => `${monthPrefix}-${String(d).padStart(2, "0")}`;

/* ----- fixtures ---------------------------------------------------------- */

const DEMO_CHEFS = [
  {
    fullName: "Demo · Sander Bakker",
    email: "demo-sander@example.com",
    city: "Amsterdam",
    vakniveau: "sous_chef" as const,
    segments: ["fine_dining", "hotel"],
    specialties: "patisserie, Frans, banketkok",
    yearsExperience: 8,
    languages: ["nl", "en"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Eva van Dijk",
    email: "demo-eva@example.com",
    city: "Rotterdam",
    vakniveau: "chef_de_partie" as const,
    segments: ["casual", "event"],
    specialties: "grill, Mediterraans",
    yearsExperience: 5,
    languages: ["nl", "en", "fr"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Jan Janssen",
    email: "demo-jan@example.com",
    city: "Utrecht",
    vakniveau: "chef_de_cuisine" as const,
    segments: ["fine_dining", "hotel", "banqueting"],
    specialties: "Frans haute cuisine, sauces, brigade-leiderschap",
    yearsExperience: 15,
    languages: ["nl", "en", "fr"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Lisa de Vries",
    email: "demo-lisa@example.com",
    city: "Amsterdam",
    vakniveau: "patissier" as const,
    segments: ["fine_dining", "hotel"],
    specialties: "patisserie, ijsbereiding, viennoiserie",
    yearsExperience: 6,
    languages: ["nl", "en"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Ahmed Hassan",
    email: "demo-ahmed@example.com",
    city: "Den Haag",
    vakniveau: "sous_chef" as const,
    segments: ["casual", "catering"],
    specialties: "Midden-Oosters, banqueting, halal",
    yearsExperience: 7,
    languages: ["nl", "en", "ar"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Maria Garcia",
    email: "demo-maria@example.com",
    city: "Amsterdam",
    vakniveau: "chef_de_partie" as const,
    segments: ["casual"],
    specialties: "Spaans, tapas, Latijns-Amerikaans",
    yearsExperience: 4,
    languages: ["nl", "en", "es"],
    status: "active" as const,
  },
  {
    fullName: "Demo · Peter Mulder",
    email: "demo-peter@example.com",
    city: "Amsterdam",
    vakniveau: "commis" as const,
    segments: ["casual", "event"],
    specialties: "leerling, basisvaardigheden",
    yearsExperience: 1,
    languages: ["nl", "en"],
    status: "onboarding" as const,
  },
  {
    fullName: "Demo · Sophie Smit",
    email: "demo-sophie@example.com",
    city: "Amsterdam",
    vakniveau: "chef_de_partie" as const,
    segments: ["fine_dining"],
    specialties: "groente, vegetarisch, fermentatie",
    yearsExperience: 3,
    languages: ["nl", "en"],
    status: "active" as const,
  },
];

const DEMO_CLIENTS = [
  {
    companyName: "Demo · Restaurant De Voorbeeld",
    contactName: "Eva van der Berg",
    email: "demo-clientA@example.com",
    city: "Amsterdam",
    segment: "fine_dining" as const,
    address: "Voorbeeldstraat 12",
    status: "active" as const,
    paymentTermsDays: 14,
  },
  {
    companyName: "Demo · Hotel Demo Plaza",
    contactName: "Mark Jansen",
    email: "demo-clientB@example.com",
    city: "Amsterdam",
    segment: "hotel" as const,
    address: "Hotelboulevard 1",
    status: "active" as const,
    paymentTermsDays: 30,
  },
  {
    companyName: "Demo · Brasserie Test",
    contactName: "Anne de Wit",
    email: "demo-clientC@example.com",
    city: "Rotterdam",
    segment: "casual" as const,
    status: "active" as const,
    paymentTermsDays: 14,
  },
  {
    companyName: "Demo · Catering Voorbeeld",
    contactName: "Tom Bakker",
    email: "demo-clientD@example.com",
    city: "Utrecht",
    segment: "catering" as const,
    status: "active" as const,
    paymentTermsDays: 14,
  },
];

/* ----- seed -------------------------------------------------------------- */

async function clearDemoData() {
  // Demo shifts now carry placements (which may have advanced to shift_hours via the
  // complete-placements worker). placements CASCADE on shift-delete, but shift_hours,
  // shift_hour_corrections and ratings are RESTRICT — so clear that chain first, in FK order:
  //   corrections → shift_hours → shifts   and   ratings → placements → shifts.
  const demoShiftIds = (await dbClient.select({ id: shifts.id }).from(shifts).where(like(shifts.notes, `%${DEMO_MARKER}%`))).map((r) => r.id);
  if (demoShiftIds.length) {
    const demoPlacementIds = (await dbClient.select({ id: placements.id }).from(placements).where(inArray(placements.shiftId, demoShiftIds))).map((r) => r.id);
    const demoHoursIds = (await dbClient.select({ id: shiftHours.id }).from(shiftHours).where(inArray(shiftHours.shiftId, demoShiftIds))).map((r) => r.id);
    if (demoHoursIds.length) await dbClient.delete(shiftHourCorrections).where(inArray(shiftHourCorrections.originalShiftHoursId, demoHoursIds));
    await dbClient.delete(shiftHours).where(inArray(shiftHours.shiftId, demoShiftIds));
    if (demoPlacementIds.length) await dbClient.delete(ratings).where(inArray(ratings.placementId, demoPlacementIds));
  }
  await dbClient.delete(shifts).where(like(shifts.notes, `%${DEMO_MARKER}%`)); // cascades placements
  await dbClient.delete(clientSubmissions).where(like(clientSubmissions.notes, `%${DEMO_MARKER}%`));
  await dbClient.delete(chefs).where(like(chefs.notes, `%${DEMO_MARKER}%`)); // chefs/clients.userId → set null on user delete
  await dbClient.delete(clients).where(like(clients.notes, `%${DEMO_MARKER}%`));
  // Demo login accounts last (chefs/clients above already released their userId FK).
  await dbClient.delete(users).where(like(users.seedKey, `${DEMO_MARKER}%`));
}

async function seedDemo() {
  console.log("Seeding demo fixtures (marker: " + DEMO_MARKER + ")\n");

  console.log("  → clearing previous demo rows...");
  await clearDemoData();

  console.log(`  → inserting ${DEMO_CHEFS.length} demo chefs...`);
  const insertedChefs = await dbClient
    .insert(chefs)
    .values(
      DEMO_CHEFS.map((c) => ({ ...c, notes: DEMO_MARKER })),
    )
    .returning({ id: chefs.id, fullName: chefs.fullName });

  console.log(`  → inserting ${DEMO_CLIENTS.length} demo clients...`);
  const insertedClients = await dbClient
    .insert(clients)
    .values(
      DEMO_CLIENTS.map((c) => ({ ...c, notes: DEMO_MARKER })),
    )
    .returning({ id: clients.id, companyName: clients.companyName });

  // Login-able accounts so the demo can impersonate a chef + a klant ("Bekijk als"
  // from /admin/system/users) and walk all three portals from one super_admin login.
  console.log("  → inserting demo login accounts (1 chef + 1 klant) for impersonation...");
  const [chefUser] = await dbClient
    .insert(users)
    .values({ email: "demo-chef@chefandserve.demo", kind: "chef", status: "active", name: insertedChefs[0].fullName, seedKey: `${DEMO_MARKER}:chef` })
    .returning({ id: users.id });
  const [klantUser] = await dbClient
    .insert(users)
    .values({ email: "demo-klant@chefandserve.demo", kind: "client", status: "active", name: insertedClients[1].companyName, seedKey: `${DEMO_MARKER}:klant` })
    .returning({ id: users.id });
  await dbClient.update(chefs).set({ userId: chefUser.id }).where(eq(chefs.id, insertedChefs[0].id));
  await dbClient.update(clients).set({ userId: klantUser.id }).where(eq(clients.id, insertedClients[1].id));

  console.log("  → inserting demo shifts + placements (rich roster spread)...");

  // Reuse the seeded chefs/clients by insertion-order index. The spread covers TODAY
  // (the day-board showcase: gevuld / onderbezet / kritiek / te-bevestigen + a double-book),
  // the rest of THIS WEEK (dense week grid), and across THIS MONTH (heatmap) — in mixed
  // placement states so every roster colour + the attention rail + the supply rail show.
  const ch = insertedChefs; // 8
  const cl = insertedClients; // 4
  type Fill = { conf?: number[]; acc?: number[]; prop?: number[] };
  type Spec = { c: number; day: string; sh: number; eh: number; role: string; hc: number; segment?: string; fill?: Fill };
  const t = todayKey;
  const specs: Spec[] = [
    { c: 0, day: t, sh: 7, eh: 11, role: "chef_de_partie", hc: 2, segment: "hotel", fill: { conf: [0, 1] } },
    { c: 0, day: t, sh: 17, eh: 23, role: "sous_chef", hc: 3, segment: "hotel", fill: { conf: [2], acc: [3] } },
    { c: 1, day: t, sh: 11, eh: 15, role: "chef_de_partie", hc: 1, segment: "hotel", fill: { prop: [4] } },
    { c: 1, day: t, sh: 18, eh: 23, role: "sous_chef", hc: 2, segment: "hotel", fill: { conf: [2], acc: [5] } },
    { c: 2, day: t, sh: 20, eh: 23, role: "patissier", hc: 1, segment: "fine_dining", fill: { conf: [3] } },
    { c: 0, day: addDays(t, -2), sh: 17, eh: 23, role: "sous_chef", hc: 2, fill: { conf: [0, 1] } },
    { c: 1, day: addDays(t, -1), sh: 8, eh: 12, role: "chef_de_partie", hc: 2, fill: { conf: [6] } },
    { c: 3, day: addDays(t, -1), sh: 18, eh: 23, role: "chef_de_cuisine", hc: 2, fill: { conf: [2, 7] } },
    { c: 2, day: addDays(t, 1), sh: 17, eh: 23, role: "sous_chef", hc: 2, fill: { conf: [3], acc: [4] } },
    { c: 3, day: addDays(t, 1), sh: 11, eh: 15, role: "chef_de_partie", hc: 1, fill: {} },
  ];
  const monthPlan: Array<[number, number, number, number, number]> = [
    [3, 0, 2, 2, 0], [5, 1, 2, 1, 0], [7, 2, 1, 1, 0], [9, 3, 3, 2, 1],
    [12, 0, 2, 0, 0], [14, 1, 1, 1, 0], [16, 2, 2, 2, 0], [19, 3, 2, 1, 0],
    [21, 0, 1, 0, 0], [23, 1, 2, 2, 0], [26, 2, 2, 1, 1], [27, 3, 1, 1, 0],
  ];
  let cur = 0;
  const pick = (n: number) => Array.from({ length: n }, () => cur++ % ch.length);
  for (const [d, c, hc, conf, acc] of monthPlan) {
    const dk = monthDay(d);
    if (dk === t) continue;
    specs.push({ c, day: dk, sh: 17, eh: 23, role: "sous_chef", hc, fill: { conf: pick(conf), acc: pick(acc) } });
  }

  const RATES: Record<string, [number, number]> = {
    commis: [3200, 2200],
    chef_de_partie: [4000, 2900],
    sous_chef: [4500, 3250],
    patissier: [4200, 3000],
    chef_de_cuisine: [5500, 4000],
  };
  const shiftRows = specs.map((s) => {
    const [clientRateCents, chefRateCents] = RATES[s.role] ?? [4000, 2900];
    return {
      clientId: cl[s.c].id,
      startsAt: at(s.day, s.sh),
      endsAt: at(s.day, s.eh),
      roleNeeded: s.role as (typeof shifts.$inferInsert)["roleNeeded"],
      segment: (s.segment ?? "hotel") as (typeof shifts.$inferInsert)["segment"],
      headcount: s.hc,
      city: "Amsterdam",
      location: cl[s.c].companyName ?? "Amsterdam",
      clientRateCents,
      chefRateCents,
      status: ((s.fill?.conf?.length ?? 0) >= s.hc ? "filled" : "open") as (typeof shifts.$inferInsert)["status"],
      notes: DEMO_MARKER,
    };
  });
  const insertedShifts = await dbClient.insert(shifts).values(shiftRows).returning({ id: shifts.id });

  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 3_600_000);
  const placeRows: (typeof placements.$inferInsert)[] = [];
  specs.forEach((s, i) => {
    const shiftId = insertedShifts[i].id;
    for (const k of s.fill?.conf ?? [])
      placeRows.push({ shiftId, chefId: ch[k].id, status: "confirmed", proposedAt: threeHoursAgo, respondedAt: threeHoursAgo, confirmedAt: now, notes: DEMO_MARKER });
    for (const k of s.fill?.acc ?? [])
      placeRows.push({ shiftId, chefId: ch[k].id, status: "accepted", proposedAt: threeHoursAgo, respondedAt: now, notes: DEMO_MARKER });
    for (const k of s.fill?.prop ?? [])
      placeRows.push({ shiftId, chefId: ch[k].id, status: "proposed", proposedAt: threeHoursAgo, notes: DEMO_MARKER });
  });
  // de-dupe (chef,shift) — a chef can hold only one placement per shift
  const seenPlace = new Set<string>();
  const dedupPlace = placeRows.filter((p) => {
    const key = `${p.shiftId}:${p.chefId}`;
    if (seenPlace.has(key)) return false;
    seenPlace.add(key);
    return true;
  });
  if (dedupPlace.length) await dbClient.insert(placements).values(dedupPlace);

  /* ----- Past completed shifts → hours + ratings ---------------------------
     Lights up the MONEY KPIs (omzet/loonkost/marge from admin_approved hours),
     the "uren te tekenen" (klant) + "uren te keuren" (owner) work-queues, and
     chef ratings. [daysAgo, clientIdx, chefIdx, role, hoursStatus]. Chef 0 (the
     linked demo chef) + client 1 (the linked demo klant) are seeded with their
     own approved earnings / pending-to-sign hours so their portals look alive. */
  console.log("  → inserting past completed shifts + hours + ratings...");
  type HStat = "submitted" | "client_signed" | "admin_approved";
  const pastSpecs: Array<[number, number, number, string, HStat]> = [
    [3, 1, 0, "sous_chef", "submitted"], // Hotel (linked klant) + Sander (linked chef) → klant 'uren te tekenen'
    [5, 0, 0, "sous_chef", "admin_approved"], // Sander earnings
    [7, 1, 2, "chef_de_cuisine", "admin_approved"],
    [9, 2, 1, "chef_de_partie", "client_signed"], // owner 'uren te keuren'
    [11, 3, 4, "sous_chef", "admin_approved"],
    [13, 0, 3, "patissier", "admin_approved"],
    [15, 1, 5, "chef_de_partie", "submitted"], // another klant 'te tekenen'
    [17, 2, 0, "sous_chef", "admin_approved"], // Sander earnings
    [20, 3, 2, "chef_de_cuisine", "client_signed"],
    [24, 0, 7, "chef_de_partie", "admin_approved"],
  ];
  const pastShiftRows = pastSpecs.map(([daysAgo, cidx, , role]) => {
    const dk = addDays(t, -daysAgo);
    const [clientRateCents, chefRateCents] = RATES[role] ?? [4000, 2900];
    return {
      clientId: cl[cidx].id,
      startsAt: at(dk, 17),
      endsAt: at(dk, 23),
      roleNeeded: role as (typeof shifts.$inferInsert)["roleNeeded"],
      segment: "hotel" as (typeof shifts.$inferInsert)["segment"],
      headcount: 1,
      city: "Amsterdam",
      location: cl[cidx].companyName ?? "Amsterdam",
      clientRateCents,
      chefRateCents,
      status: "completed" as (typeof shifts.$inferInsert)["status"],
      notes: DEMO_MARKER,
    };
  });
  const pastShifts = await dbClient.insert(shifts).values(pastShiftRows).returning({ id: shifts.id });

  const pastPlaceRows = pastSpecs.map(([daysAgo, , chidx], i) => {
    const dk = addDays(t, -daysAgo);
    return {
      shiftId: pastShifts[i].id,
      chefId: ch[chidx].id,
      status: "completed" as const,
      proposedAt: at(dk, 9),
      respondedAt: at(dk, 10),
      confirmedAt: at(dk, 11),
      completedAt: at(dk, 23),
      notes: DEMO_MARKER,
    };
  });
  const pastPlacements = await dbClient.insert(placements).values(pastPlaceRows).returning({ id: placements.id });

  const hoursRows = pastSpecs.map(([daysAgo, cidx, chidx, role, hstatus], i) => {
    const dk = addDays(t, -daysAgo);
    const [clientRateCents, chefRateCents] = RATES[role] ?? [4000, 2900];
    const end = at(dk, 23);
    return {
      placementId: pastPlacements[i].id,
      shiftId: pastShifts[i].id,
      chefId: ch[chidx].id,
      clientId: cl[cidx].id,
      startedAt: at(dk, 17),
      endedAt: end,
      breakMinutes: 30,
      workedMinutes: 330, // 6h − 30min break
      chefRateCents,
      clientRateCents,
      status: hstatus,
      submittedAt: new Date(end.getTime() + 2 * 3_600_000),
      clientSignedAt: hstatus === "submitted" ? null : new Date(end.getTime() + 20 * 3_600_000),
      adminApprovedAt: hstatus === "admin_approved" ? new Date(end.getTime() + 26 * 3_600_000) : null,
    };
  });
  await dbClient.insert(shiftHours).values(hoursRows);

  // Ratings on the fully-approved placements → owner ratings KPI + chef averages.
  const TAGS = [["professioneel", "flexibel"], ["sterke communicatie"], ["op tijd", "netjes"], ["teamspeler"]];
  const ratingRows = pastSpecs
    .map(([, cidx, chidx, , hstatus], i) => ({ cidx, chidx, hstatus, i }))
    .filter((r) => r.hstatus === "admin_approved")
    .map((r, n) => ({
      placementId: pastPlacements[r.i].id,
      chefId: ch[r.chidx].id,
      clientId: cl[r.cidx].id,
      stars: n % 3 === 0 ? 5 : 4,
      tags: TAGS[n % TAGS.length],
      comment: n % 2 === 0 ? "Sterke dienst, graag weer." : null,
    }));
  if (ratingRows.length) await dbClient.insert(ratings).values(ratingRows);

  // Recompute the chef rating rollup for demo chefs (raw inserts skip the domain recompute).
  await dbClient
    .update(chefs)
    .set({
      averageRating: sql`(SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE chef_id = ${chefs.id})`,
      ratingCount: sql`(SELECT count(*)::int FROM ratings WHERE chef_id = ${chefs.id})`,
    })
    .where(like(chefs.notes, `%${DEMO_MARKER}%`));

  // One pending portal request for the linked klant → /client/requests + owner inbox + the K3 flow.
  await dbClient.insert(clientSubmissions).values({
    externalId: `demo-${t}-okura`,
    source: "client_portal",
    clientId: cl[1].id,
    companyName: insertedClients[1].companyName,
    contactName: "Mark Jansen",
    roleRequested: "sous_chef",
    segment: "hotel",
    headcount: 2,
    dateNeeded: addDays(t, 9),
    status: "triaged",
    rawPayload: { demo: true },
    notes: DEMO_MARKER,
  });

  const approvedCount = ratingRows.length;
  console.log("\n✓ Demo seed complete.");
  console.log(`  login accounts: chef demo-chef@chefandserve.demo + klant demo-klant@chefandserve.demo (impersonate via Bekijk als)`);
  console.log(`  past shifts:    ${pastShifts.length} completed (hours + ratings)`);
  console.log(`  hours:          ${hoursRows.length} (${approvedCount} approved → omzet/marge · rest in te-tekenen/te-keuren queues)`);
  console.log(`  ratings:        ${ratingRows.length}`);
  console.log(`  chefs:      ${insertedChefs.length}`);
  console.log(`  clients:    ${insertedClients.length}`);
  console.log(`  shifts:     ${insertedShifts.length} (today + week + month)`);
  console.log(`  placements: ${dedupPlace.length} (confirmed/accepted/proposed)`);
  console.log("\nVisit /admin/business to see the populated cockpit.");
  console.log("\nTo remove: re-run this script (it clears demo rows first),");
  console.log("or run in psql:");
  console.log(`  DELETE FROM shifts WHERE notes LIKE '%${DEMO_MARKER}%';`);
  console.log(`  DELETE FROM chefs WHERE notes LIKE '%${DEMO_MARKER}%';`);
  console.log(`  DELETE FROM clients WHERE notes LIKE '%${DEMO_MARKER}%';`);
}

seedDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Demo seed failed:", err);
    process.exit(1);
  });

// Suppress unused-warning for eq (kept for future filters)
void eq;
