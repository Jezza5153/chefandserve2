/**
 * document-expiry worker — PR-CHEF-12.
 *
 * Daily cron. Two responsibilities:
 *
 *   1. Find chef_documents with expiresAt < now() AND status != 'expired'
 *      → flip status to 'expired' and notify the chef + admin.
 *
 *   2. Find chef_documents with expiresAt within next 30 days AND
 *      status='verified' AND no expiry-warning notification in last 30 days
 *      → create chef notification + send email (optional in V1 — for now
 *      just creates the in-app notification).
 *
 * Run manually: `tsx workers/document-expiry.ts`
 */

import { log, sql } from "./_lib";

async function main() {
  log("document-expiry: starting");

  // ----- Step 1: mark expired -----
  const justExpired = (await sql`
    UPDATE chef_documents
    SET status = 'expired'
    WHERE status = 'verified'
      AND expires_at IS NOT NULL
      AND expires_at < now()
      AND deleted_at IS NULL
    RETURNING id, chef_id, type, filename
  `) as Array<{ id: string; chef_id: string; type: string; filename: string }>;

  log(`marked ${justExpired.length} documents as expired`);

  for (const d of justExpired) {
    // Find chef's userId
    const [chef] = (await sql`
      SELECT user_id, full_name FROM chefs WHERE id = ${d.chef_id}
    `) as Array<{ user_id: string | null; full_name: string }>;
    if (chef?.user_id) {
      await sql`
        INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
        VALUES (
          ${chef.user_id},
          'document_expired',
          'Document verlopen',
          ${`${d.filename} is verlopen — vraag het kantoor om een nieuwe versie te uploaden.`},
          '/chef/profile',
          'chef_document',
          ${d.id}
        )
      `;
    }
    await sql`
      INSERT INTO audit_log (action, resource, resource_id, after)
      VALUES (
        'chef_documents.expired_auto',
        'chef_documents',
        ${d.id},
        ${{ chefId: d.chef_id, filename: d.filename, type: d.type }}::jsonb
      )
    `;
  }

  // ----- Step 2: 30-day expiry warnings -----
  // Find docs expiring within 30d AND no expiry-warning notif in last 30d
  // (we use entityType='chef_document' + type='document_expiring_soon' as
  // the cooldown marker)
  const warnings = (await sql`
    SELECT
      d.id, d.chef_id, d.type, d.filename, d.expires_at,
      c.user_id, c.full_name
    FROM chef_documents d
    INNER JOIN chefs c ON c.id = d.chef_id
    WHERE d.status = 'verified'
      AND d.expires_at IS NOT NULL
      AND d.expires_at > now()
      AND d.expires_at < now() + interval '30 days'
      AND d.deleted_at IS NULL
      AND c.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = c.user_id
          AND n.entity_type = 'chef_document'
          AND n.entity_id = d.id
          AND n.type = 'document_expiring_soon'
          AND n.created_at > now() - interval '30 days'
      )
  `) as Array<{
    id: string;
    chef_id: string;
    type: string;
    filename: string;
    expires_at: Date;
    user_id: string;
    full_name: string;
  }>;

  log(`creating ${warnings.length} expiry-warning notifications`);

  for (const d of warnings) {
    const daysLeft = Math.ceil(
      (new Date(d.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    await sql`
      INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
      VALUES (
        ${d.user_id},
        'document_expiring_soon',
        ${`${d.filename} verloopt binnen ${daysLeft} dagen`},
        'Upload een nieuwe versie via Chef & Serve.',
        '/chef/profile',
        'chef_document',
        ${d.id}
      )
    `;
    await sql`
      INSERT INTO audit_log (action, resource, resource_id, after)
      VALUES (
        'chef_documents.expiry_warned',
        'chef_documents',
        ${d.id},
        ${{ chefId: d.chef_id, daysLeft }}::jsonb
      )
    `;
  }

  log(`done`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[document-expiry] FAILED:", err);
    process.exit(1);
  });
