/**
 * One-off seed — creates a test chef + test client, links them to user
 * rows, sends portal-invite emails to plus-aliased addresses.
 *
 * Usage:
 *   tsx scripts/seed-test-portals.ts <chef-email> <client-email>
 *
 * Example:
 *   tsx scripts/seed-test-portals.ts info+chef@jezzacooks.com info+klant@jezzacooks.com
 *
 * Idempotent: marks rows with notes `[test-portal-seed]`. Re-runs delete
 * the prior rows + recreate.
 *
 * Run from project root with .env.local populated.
 */
import { config } from "dotenv";
import { eq, like } from "drizzle-orm";

config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { chefs, clients, users } from "@/lib/db/schema";
import {
  activatePortalUser,
  inviteChefToPortal,
  inviteClientToPortal,
} from "@/lib/domain/portal-invites";

const MARKER = "[test-portal-seed]";

async function findActingUser(): Promise<string> {
  // Use the seeded super_admin (Jezza) as the acting user for audit.
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.seedKey, "jezza"))
    .limit(1);
  if (!u) {
    throw new Error("Seed user 'jezza' missing — run `npm run db:seed` first");
  }
  return u.id;
}

async function clearPriorTestSeed(chefEmail: string, clientEmail: string) {
  // Delete chef/client rows tagged with marker
  await db.delete(chefs).where(like(chefs.notes, `%${MARKER}%`));
  await db.delete(clients).where(like(clients.notes, `%${MARKER}%`));
  // Delete the user rows for these emails too
  await db.delete(users).where(eq(users.email, chefEmail.toLowerCase()));
  await db.delete(users).where(eq(users.email, clientEmail.toLowerCase()));
}

async function main() {
  const [chefEmailRaw, clientEmailRaw] = process.argv.slice(2);
  if (!chefEmailRaw || !clientEmailRaw) {
    console.error(
      "Usage: tsx scripts/seed-test-portals.ts <chef-email> <client-email>",
    );
    process.exit(1);
  }
  const chefEmail = chefEmailRaw.trim().toLowerCase();
  const clientEmail = clientEmailRaw.trim().toLowerCase();

  console.log(`Seeding test portal accounts:`);
  console.log(`  chef:   ${chefEmail}`);
  console.log(`  klant:  ${clientEmail}`);
  console.log();

  const actingUserId = await findActingUser();

  console.log("→ clearing any prior test-portal seed rows…");
  await clearPriorTestSeed(chefEmail, clientEmail);

  console.log("→ inserting test chef…");
  const [chefRow] = await db
    .insert(chefs)
    .values({
      fullName: "Test Chef · Sander Bakker",
      email: chefEmail,
      phone: "+31612345678",
      city: "Amsterdam",
      vakniveau: "sous_chef",
      segments: ["fine_dining", "hotel"],
      specialties: "patisserie, Frans, banketkok",
      yearsExperience: 8,
      languages: ["nl", "en", "fr"],
      status: "active",
      notes: `${MARKER} — created by scripts/seed-test-portals.ts`,
    })
    .returning({ id: chefs.id });

  console.log("→ inserting test client…");
  const [clientRow] = await db
    .insert(clients)
    .values({
      companyName: "Test Klant · Restaurant De Voorbeeld",
      contactName: "Eva van der Berg",
      email: clientEmail,
      phone: "+31612345678",
      city: "Amsterdam",
      segment: "fine_dining",
      address: "Voorbeeldstraat 12, 1011 AB Amsterdam",
      kvk: "12345678",
      btw: "NL123456789B01",
      paymentTermsDays: 14,
      status: "active",
      notes: `${MARKER} — created by scripts/seed-test-portals.ts`,
    })
    .returning({ id: clients.id });

  console.log("→ inviting chef to portal (creates user row, status=invited)…");
  const chefInvite = await inviteChefToPortal(chefRow.id, actingUserId);
  if (!chefInvite.ok) throw new Error(`Chef invite failed: ${chefInvite.error}`);

  console.log("→ activating chef user (status=active + sends invite email)…");
  const chefActivate = await activatePortalUser(chefInvite.userId, actingUserId);
  if (!chefActivate.ok) {
    throw new Error(`Chef activate failed: ${chefActivate.error}`);
  }

  console.log("→ inviting client to portal…");
  const clientInvite = await inviteClientToPortal(clientRow.id, actingUserId);
  if (!clientInvite.ok)
    throw new Error(`Client invite failed: ${clientInvite.error}`);

  console.log("→ activating client user…");
  const clientActivate = await activatePortalUser(
    clientInvite.userId,
    actingUserId,
  );
  if (!clientActivate.ok) {
    throw new Error(`Client activate failed: ${clientActivate.error}`);
  }

  console.log();
  console.log("✓ Done.");
  console.log();
  console.log("Two PortalInviteEmail messages have been sent:");
  console.log(`  → ${chefEmail}   (chef portal)`);
  console.log(`  → ${clientEmail} (client portal)`);
  console.log();
  console.log("Next steps (in your browser):");
  console.log(`  1. Open both emails in your inbox.`);
  console.log(`  2. Click "Inloggen" in each — that takes you to /login.`);
  console.log(`  3. Enter that same email on /login → fresh magic link.`);
  console.log(`  4. Click magic link → land in /chef or /client portal.`);
  console.log();
  console.log("To clean up later:");
  console.log(`  tsx scripts/seed-test-portals.ts <same> <args>   # idempotent re-run`);
  console.log(`  -- or via psql --`);
  console.log(`  DELETE FROM chefs WHERE notes LIKE '%${MARKER}%';`);
  console.log(`  DELETE FROM clients WHERE notes LIKE '%${MARKER}%';`);
  console.log(`  DELETE FROM users WHERE email IN ('${chefEmail}','${clientEmail}');`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n✗ Seed failed:", e);
    process.exit(1);
  });
