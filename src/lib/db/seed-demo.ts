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
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

import { chefs, clients, shifts } from "./schema";

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

function daysFromNow(days: number, hour = 18): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function clearDemoData() {
  // shifts → clients (FK cascade) so delete shifts first
  await dbClient.delete(shifts).where(like(shifts.notes, `%${DEMO_MARKER}%`));
  await dbClient.delete(chefs).where(like(chefs.notes, `%${DEMO_MARKER}%`));
  await dbClient
    .delete(clients)
    .where(like(clients.notes, `%${DEMO_MARKER}%`));
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

  console.log("  → inserting demo shifts...");

  const restoVoorbeeld = insertedClients.find((c) =>
    c.companyName?.includes("Voorbeeld"),
  );
  const hotelPlaza = insertedClients.find((c) =>
    c.companyName?.includes("Plaza"),
  );
  const brasserie = insertedClients.find((c) =>
    c.companyName?.includes("Brasserie"),
  );
  const catering = insertedClients.find((c) =>
    c.companyName?.includes("Catering"),
  );

  if (restoVoorbeeld && hotelPlaza && brasserie && catering) {
    await dbClient.insert(shifts).values([
      {
        clientId: restoVoorbeeld.id,
        startsAt: daysFromNow(2, 17),
        endsAt: daysFromNow(2, 23),
        roleNeeded: "sous_chef",
        segment: "fine_dining",
        headcount: 1,
        city: "Amsterdam",
        location: "Voorbeeldstraat 12",
        clientRateCents: 4500,
        chefRateCents: 3250,
        status: "open",
        notes: DEMO_MARKER,
      },
      {
        clientId: hotelPlaza.id,
        startsAt: daysFromNow(3, 16),
        endsAt: daysFromNow(3, 23),
        roleNeeded: "chef_de_partie",
        segment: "hotel",
        headcount: 2,
        city: "Amsterdam",
        location: "Hotelboulevard 1",
        clientRateCents: 4000,
        chefRateCents: 2900,
        status: "open",
        notes: DEMO_MARKER,
      },
      {
        clientId: brasserie.id,
        startsAt: daysFromNow(5, 17),
        endsAt: daysFromNow(5, 23),
        roleNeeded: "chef_de_partie",
        segment: "casual",
        headcount: 1,
        city: "Rotterdam",
        clientRateCents: 3500,
        chefRateCents: 2500,
        status: "request",
        notes: DEMO_MARKER,
      },
      {
        clientId: catering.id,
        startsAt: daysFromNow(6, 11),
        endsAt: daysFromNow(6, 17),
        roleNeeded: "chef_de_cuisine",
        segment: "catering",
        headcount: 1,
        city: "Utrecht",
        clientRateCents: 5500,
        chefRateCents: 4000,
        status: "filled",
        notes: DEMO_MARKER,
      },
    ]);
  }

  console.log("\n✓ Demo seed complete.");
  console.log(`  chefs:   ${insertedChefs.length}`);
  console.log(`  clients: ${insertedClients.length}`);
  console.log(`  shifts:  4`);
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
