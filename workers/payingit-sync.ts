/**
 * Payingit sync — Friday 17:00.
 *
 * STATUS: STUB. Awaiting Payingit integration spec (CSV/SFTP/API).
 *
 * Once Maarten has the 30-min call with Payingit, we plug their interface
 * here. Until then this worker:
 *   1. Selects approved hours from the past week
 *   2. Logs them to console (so we can see what WOULD be pushed)
 *   3. Sends Maarten an email summary
 *   4. Audit-logs the dry-run
 *
 * When the real Payingit integration ships, replace the "Phase 5: actual push"
 * comment with: CSV upload via SFTP, or REST API POST, or whatever they support.
 */
import { sql, sendPlainEmail, audit, log } from "./_lib";

async function main() {
  log("payingit-sync start (STUB MODE)");

  // Pull approved hours from the past week
  // Hours table doesn't exist yet (Phase 5 lands it). For now, fall back to
  // completed placements as the proxy.
  const completed = await sql`
    SELECT p.id, p.chef_id, p.shift_id, s.role_needed, s.starts_at, s.ends_at,
           s.chef_rate_cents, c.full_name AS chef_name, cl.company_name
    FROM placements p
    INNER JOIN shifts s ON s.id = p.shift_id
    INNER JOIN chefs c ON c.id = p.chef_id
    INNER JOIN clients cl ON cl.id = s.client_id
    WHERE p.status = 'completed'
      AND p.completed_at > now() - interval '7 days'
    ORDER BY s.starts_at DESC
  `;

  log(`Found ${completed.length} completed placements in past 7 days`);
  if (completed.length === 0) {
    log("Nothing to sync — exiting");
    process.exit(0);
  }

  // Phase 5: ACTUAL PUSH TO PAYINGIT WOULD HAPPEN HERE
  // For now we just log + email
  const summary = completed
    .map(
      (r) =>
        `  ${r.chef_name} @ ${r.company_name} · ${new Date(r.starts_at).toLocaleDateString("nl-NL")} · ${r.role_needed}`,
    )
    .join("\n");
  log("Dry-run summary:\n" + summary);

  const recipient = process.env.MAARTEN_EMAIL;
  if (recipient) {
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
        <h1 style="font-family: Georgia, serif; color: #29292A;">Payingit sync (dry-run)</h1>
        <p style="color: #29292A;">
          De Payingit-bridge is nog niet live. ${completed.length} voltooide
          plaatsingen wachten op uitbetaling. Zodra Phase 5 ship't, worden
          deze automatisch elke vrijdag verstuurd.
        </p>
        <h2 style="font-family: Georgia, serif; color: #29292A; margin-top: 24px;">
          Plaatsingen wachtend (${completed.length})
        </h2>
        <ul style="line-height: 1.8; color: #29292A; font-size: 13px;">
          ${completed
            .map(
              (r) =>
                `<li><strong>${r.chef_name}</strong> @ ${r.company_name} — ${new Date(r.starts_at).toLocaleDateString("nl-NL")} · ${r.role_needed}</li>`,
            )
            .join("")}
        </ul>
      </div>
    `;
    const sendResult = await sendPlainEmail(
      recipient,
      `[Stub] Payingit-sync: ${completed.length} plaatsingen wachten`,
      html,
    );
    log(`email send: ${sendResult.ok ? "ok" : `fail ${sendResult.error}`}`);
  }

  await audit("worker.payingit_sync_dryrun", "system", null, {
    placementCount: completed.length,
    mode: "STUB",
  });

  process.exit(0);
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
