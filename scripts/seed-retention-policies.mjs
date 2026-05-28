/**
 * seed-retention-policies — PR-AVG-3. Idempotent seed of the bewaartermijn
 * matrix into `retention_policies` (mirrors docs/privacy/retention-matrix.md).
 *
 * ON CONFLICT DO NOTHING — never overwrites an admin-edited period. Run once
 * after deploy; safe to re-run.
 *
 *   node scripts/seed-retention-policies.mjs
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

/** [entity_type, retention_period (PG interval), legal_basis, description] */
const DEFAULTS = [
  ["shift_hours", "7 years", "Fiscale bewaarplicht (art. 52 AWR)", "Gewerkte uren — loonadministratie. Niet wisbaar op verzoek (legal hold)."],
  ["payroll_batches", "7 years", "Fiscale bewaarplicht (art. 52 AWR)", "Loon-/facturatie-export. Legal hold."],
  ["payroll_batch_lines", "7 years", "Fiscale bewaarplicht (art. 52 AWR)", "Loonregels. Legal hold."],
  ["shift_hour_corrections", "7 years", "Fiscale bewaarplicht (art. 52 AWR)", "Correcties op loonregels. Legal hold."],
  ["chefs", "7 years", "Administratie / opslagbeperking", "Geanonimiseerd bij vertrek; rij pas verwijderd na bewaartermijn als geen hold."],
  ["clients", "7 years", "Administratie (facturatie)", "Contactpersoon geanonimiseerd; bedrijfs-/factuurgegevens onder administratie."],
  ["chef_documents", "2 years", "Opslagbeperking (art. 5(1)(e))", "Soft-deleted documenten + R2-bytes opgeruimd na bewaartermijn."],
  ["consent_log", "7 years", "Verantwoordingsplicht (art. 7(1) / 5(2))", "Bewijs van gegeven toestemming."],
  ["audit_log", "2 years", "Beveiliging / verantwoording (art. 5(2))", "Beveiligings- en wijzigingslog."],
  ["privacy_requests", "3 years", "Verantwoording (AVG-afhandeling)", "Bewijs dat verzoeken zijn afgehandeld."],
  ["webhooks_received", "90 days", "Opslagbeperking (art. 5(1)(e))", "Ruwe inkomende payloads — replay/forensics-venster."],
  ["email_events", "90 days", "Opslagbeperking (art. 5(1)(e))", "Provider-webhook events."],
  ["notifications", "1 year", "Opslagbeperking (art. 5(1)(e))", "In-app meldingen."],
  ["rate_limits", "7 days", "Opslagbeperking (art. 5(1)(e))", "Pseudonieme rate-limit sleutels."],
];

let inserted = 0;
for (const [entityType, period, basis, desc] of DEFAULTS) {
  const r = await sql`
    INSERT INTO retention_policies (entity_type, retention_period, legal_basis, description)
    VALUES (${entityType}, ${period}, ${basis}, ${desc})
    ON CONFLICT (entity_type) DO NOTHING
    RETURNING entity_type`;
  if (r.length > 0) inserted++;
}

const total = await sql`SELECT count(*)::int AS n FROM retention_policies`;
console.log(`seed-retention-policies: inserted ${inserted} new · ${total[0].n} total policies.`);
