/**
 * One-off: provision the owner demo accounts (Maarten + Gina) so they can log in
 * directly — without depending on magic-link email (their placeholder mailboxes
 * don't receive mail) and without weakening the global TOTP requirement.
 *
 * For each (seedKey ∈ {maarten, gina}) it sets: status='active', a bcrypt password
 * hash (from DEMO_OWNER_PASSWORD), and a freshly-enrolled TOTP secret, then issues
 * 8 recovery codes. Prints the otpauth:// enrollment URI + recovery codes ONCE so
 * the operator can add them to an authenticator app. The owner role is left intact
 * (the main seed already assigned it) and re-asserted idempotently.
 *
 * SAFETY: refuses to run unless DATABASE_URL points at the prod host (ep-icy-scene).
 * This is an intentional prod provisioning op — run it with the unpooled prod URL:
 *
 *   DATABASE_URL="$(grep ^DATABASE_URL_UNPOOLED .env.prod.pull | cut -d= -f2-)" \
 *   DEMO_OWNER_PASSWORD='...' \
 *   npx tsx --env-file=.env.prod.pull scripts/provision-demo-owners.mts
 *
 * Demo-only: the password is intentionally simple. Rotate (or reset 2FA) before launch.
 */
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";

import { db } from "@/lib/db/client";
import { users, userRoles, roles } from "@/lib/db/schema";
import { hashPassword } from "@/lib/passwords";
import { encryptSecret } from "@/lib/totp";
import { generateAndPersist } from "@/lib/recovery-codes";

// Mirror src/lib/totp.ts generateSecret + buildProvisioningUri inline — importing the
// QR helper from that module trips tsx's CJS interop on the `qrcode` dep. Same params
// (20-byte secret, SHA1/6/30) so the stored secret + authenticator codes match exactly.
const ISSUER = "Chef & Serve";
function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}
function buildProvisioningUri(secretBase32: string, accountEmail: string): string {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountEmail,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).toString();
}

const TARGET_SEED_KEYS = ["maarten", "gina"] as const;

function hostOf(url: string): string {
  const m = url.match(/@([^/:?]+)/);
  return m?.[1] ?? "(unparseable)";
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = hostOf(url);
  if (!host.includes("ep-icy-scene")) {
    console.error(
      `REFUSING: DATABASE_URL host is [${host}] — expected prod (ep-icy-scene).\n` +
        `Set DATABASE_URL to the unpooled prod URL before running (see header).`,
    );
    process.exit(1);
  }

  const password = process.env.DEMO_OWNER_PASSWORD ?? "";
  if (password.length < 6) {
    console.error("REFUSING: set DEMO_OWNER_PASSWORD (min 6 chars).");
    process.exit(1);
  }

  const [ownerRole] = await db.select().from(roles).where(eq(roles.key, "owner")).limit(1);
  if (!ownerRole) {
    console.error("REFUSING: 'owner' role missing — run the main seed first.");
    process.exit(1);
  }

  const pwHash = await hashPassword(password);
  console.log(`Provisioning against prod host: ${host}\n`);

  for (const seedKey of TARGET_SEED_KEYS) {
    const [u] = await db.select().from(users).where(eq(users.seedKey, seedKey)).limit(1);
    if (!u) {
      console.error(`  ✗ seedKey=${seedKey} not found — skipping (run the main seed first).`);
      continue;
    }

    const secretBase32 = generateSecret();
    const encrypted = await encryptSecret(secretBase32);

    await db
      .update(users)
      .set({
        status: "active",
        passwordHash: pwHash,
        totpSecretEncrypted: encrypted,
        totpEnabled: true,
        totpEnrolledAt: new Date(),
      })
      .where(eq(users.id, u.id));

    // Re-assert the owner role (idempotent; the seed already granted it).
    await db
      .insert(userRoles)
      .values({ userId: u.id, roleId: ownerRole.id })
      .onConflictDoNothing();

    const recovery = await generateAndPersist(u.id);
    const otpauth = buildProvisioningUri(secretBase32, u.email);

    console.log(`=== ${seedKey} → ${u.email} ===`);
    console.log(`  status:   active`);
    console.log(`  password: set (DEMO_OWNER_PASSWORD)`);
    console.log(`  2FA:      enrolled — add this otpauth URI to an authenticator app:`);
    console.log(`    ${otpauth}`);
    console.log(`  recovery codes (single-use, 8): ${recovery.join("  ")}`);
    console.log("");
  }

  console.log("Done. Login = e-mail + DEMO_OWNER_PASSWORD + a 6-digit code (or a recovery code).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
