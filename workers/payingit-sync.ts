/**
 * Payingit sync — Friday 17:00.
 *
 * STATUS: DRY-RUN ONLY. The real Payingit push (CSV/SFTP/REST) is deferred
 * until Maarten has their integration call — this worker never sends anything
 * to Payingit. It exists to give an accurate weekly picture of what IS waiting
 * to be paid out, so:
 *   1. Selects admin-approved hours not yet exported to Payingit
 *   2. Logs them to console (so we can see what WOULD be pushed)
 *   3. Sends Maarten an email summary
 *   4. Audit-logs the dry-run
 *
 * SOURCE OF TRUTH: the `shift_hours` table (status='admin_approved' +
 * payingit_exported_at IS NULL) — the same rows the /admin/business/payroll
 * batch builder picks up. (Earlier this queried completed placements as a proxy
 * because the hours table didn't exist yet; it does now, so the summary is real.)
 *
 * When the real Payingit integration ships, add the actual push where the
 * "ACTUAL PUSH" comment is below.
 */
import { sql, sendPlainEmail, audit, log } from "./_lib";

async function main() {
  log("payingit-sync start (DRY-RUN)");

  // Pull admin-approved, not-yet-exported hours — the real payout backlog.
  const pending = await sql`
    SELECT h.id, h.chef_id, h.shift_id, h.worked_minutes, h.chef_rate_cents,
           s.role_needed, s.starts_at, s.ends_at,
           c.full_name AS chef_name, cl.company_name
    FROM shift_hours h
    INNER JOIN shifts s ON s.id = h.shift_id
    INNER JOIN chefs c ON c.id = h.chef_id
    INNER JOIN clients cl ON cl.id = h.client_id
    WHERE h.status = 'admin_approved'
      AND h.payingit_exported_at IS NULL
    ORDER BY s.starts_at DESC
  ` as Array<{
    id: string;
    chef_id: string;
    shift_id: string;
    worked_minutes: number;
    chef_rate_cents: number;
    role_needed: string;
    starts_at: Date;
    ends_at: Date;
    chef_name: string;
    company_name: string;
  }>;

  log(`Found ${pending.length} admin-approved hours awaiting payout`);
  if (pending.length === 0) {
    log("Nothing to sync — exiting");
    process.exit(0);
  }

  // ACTUAL PUSH TO PAYINGIT WOULD HAPPEN HERE (deferred — no real push yet).
  // For now we just log + email a summary.
  const summary = pending
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
          De Payingit-bridge is nog niet live (geen automatische push).
          ${pending.length} goedgekeurde uren-regels wachten op uitbetaling.
          Zet ze klaar via een batch op /admin/business/payroll.
        </p>
        <h2 style="font-family: Georgia, serif; color: #29292A; margin-top: 24px;">
          Goedgekeurde uren wachtend (${pending.length})
        </h2>
        <ul style="line-height: 1.8; color: #29292A; font-size: 13px;">
          ${pending
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
      `[Dry-run] Payingit-sync: ${pending.length} uren wachten op uitbetaling`,
      html,
    );
    log(`email send: ${sendResult.ok ? "ok" : `fail ${sendResult.error}`}`);
  }

  await audit("worker.payingit_sync_dryrun", "system", null, {
    hoursCount: pending.length,
    mode: "DRY_RUN",
  });

  process.exit(0);
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
