/**
 * replay-erasure-tombstones — PR-AVG-3. Backup-restore safety net.
 *
 * A restored backup can RESURRECT PII that was erased after the backup was
 * taken (AVG art. 17 violation). Per docs/privacy/backup-erasure-policy.md,
 * this script MUST run against any restored database BEFORE it serves
 * production traffic: it re-applies every erasure tombstone, re-anonymising
 * the identity rows of every subject that was erased.
 *
 * Standalone (raw SQL, no app deps) so it runs against a bare restored DB.
 * Idempotent — re-running does nothing once everything is anonymised.
 *
 *   node scripts/replay-erasure-tombstones.mjs            # apply
 *   node scripts/replay-erasure-tombstones.mjs --dry-run  # report only
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const DRY = process.argv.includes("--dry-run");

const tombs = await sql`
  SELECT id, original_user_id, original_chef_id, original_client_id
  FROM privacy_erasure_tombstones
`;

let reUser = 0;
let reChef = 0;
let reClient = 0;

for (const t of tombs) {
  // ----- user account -----
  if (t.original_user_id) {
    const [u] = await sql`SELECT email FROM users WHERE id = ${t.original_user_id}`;
    if (u && !String(u.email).startsWith("deleted-")) {
      if (!DRY) {
        await sql`
          UPDATE users SET
            email = ${`deleted-${t.original_user_id}@erased.invalid`},
            name = 'Verwijderde gebruiker', image = NULL,
            password_hash = NULL, password_set_at = NULL,
            totp_secret_encrypted = NULL, totp_enabled = false, totp_enrolled_at = NULL,
            calendar_token_secret = NULL, status = 'disabled', updated_at = now()
          WHERE id = ${t.original_user_id}`;
      }
      reUser++;
    }
  }

  // ----- chef -----
  if (t.original_chef_id) {
    const [c] = await sql`SELECT full_name, deleted_at FROM chefs WHERE id = ${t.original_chef_id}`;
    if (c && (c.deleted_at === null || c.full_name !== "Verwijderde chef")) {
      if (!DRY) {
        await sql`
          UPDATE chefs SET
            full_name = 'Verwijderde chef',
            email = NULL, phone = NULL, city = NULL,
            specialties = NULL, languages = NULL, segments = NULL, notes = NULL,
            deleted_at = COALESCE(deleted_at, now()), updated_at = now()
          WHERE id = ${t.original_chef_id}`;
      }
      reChef++;
    }
  }

  // ----- klant contact -----
  if (t.original_client_id) {
    const [cl] = await sql`SELECT contact_name, email FROM clients WHERE id = ${t.original_client_id}`;
    if (cl && (cl.contact_name !== null || cl.email !== null)) {
      if (!DRY) {
        await sql`
          UPDATE clients SET
            contact_name = NULL, email = NULL, phone = NULL,
            billing_email = NULL, notes = NULL, updated_at = now()
          WHERE id = ${t.original_client_id}`;
      }
      reClient++;
    }
  }
}

console.log(
  `replay-erasure-tombstones: ${tombs.length} tombstone(s) · re-anonymised ` +
    `users=${reUser} chefs=${reChef} clients=${reClient}${DRY ? " (dry-run — no writes)" : ""}`,
);
