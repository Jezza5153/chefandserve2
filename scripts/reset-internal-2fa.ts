/**
 * Emergency 2FA reset script — backup for when the UI is broken.
 *
 * Usage:
 *   tsx scripts/reset-internal-2fa.ts <email> --confirm
 *
 * Without --confirm it does a dry-run.
 */

import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

import {
  auditLog,
  userRecoveryCodes,
  users,
} from "@/lib/db/schema";

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL required");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const confirm = args.includes("--confirm");

if (!email) {
  console.error("Usage: tsx scripts/reset-internal-2fa.ts <email> --confirm");
  process.exit(1);
}

const dbClient = drizzle(neon(DB_URL));

async function main() {
  const [target] = await dbClient
    .select()
    .from(users)
    .where(eq(users.email, email!))
    .limit(1);

  if (!target) {
    console.error(`✗ No user found with email ${email}`);
    process.exit(1);
  }
  if (target.kind !== "internal") {
    console.error(
      `✗ User ${email} is kind=${target.kind} — only internal users have 2FA`,
    );
    process.exit(1);
  }

  console.log(`Target user:`);
  console.log(`  id:                ${target.id}`);
  console.log(`  email:             ${target.email}`);
  console.log(`  name:              ${target.name}`);
  console.log(`  totp_enabled:      ${target.totpEnabled}`);
  console.log(`  totp_enrolled_at:  ${target.totpEnrolledAt}`);
  console.log(`  perm_version:      ${target.permissionsVersion}`);
  console.log();

  if (!confirm) {
    console.log("DRY RUN — pass --confirm to actually reset.");
    console.log("Would clear: totp_secret_encrypted, totp_enabled,");
    console.log("             totp_enrolled_at, all user_recovery_codes rows");
    console.log(`Would bump permissions_version to ${target.permissionsVersion + 1}`);
    process.exit(0);
  }

  await dbClient
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      permissionsVersion: target.permissionsVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id));

  const deleted = await dbClient
    .delete(userRecoveryCodes)
    .where(eq(userRecoveryCodes.userId, target.id))
    .returning({ id: userRecoveryCodes.id });

  await dbClient.insert(auditLog).values({
    userId: null,
    action: "auth.totp_reset_by_admin",
    resource: "users",
    resourceId: target.id,
    after: {
      via: "scripts/reset-internal-2fa.ts",
      targetEmail: target.email,
    },
  });

  console.log("✓ Reset complete.");
  console.log(`  Recovery codes deleted: ${deleted.length}`);
  console.log(`  permissions_version is now: ${target.permissionsVersion + 1}`);
  console.log();
  console.log("Target user will be logged out on next request.");
  console.log("They'll need to magic-link in again, then re-enroll TOTP.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Failed:", err);
    process.exit(1);
  });
