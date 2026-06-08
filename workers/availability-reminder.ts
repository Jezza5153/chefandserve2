/**
 * availability-reminder worker — nudge active, portal-enabled chefs to fill in their
 * availability for next week. Runs Thursdays (09:00 Amsterdam) so chefs have the weekend
 * to update before next week's planning.
 *
 * GATED (PR-SET-1 style): OFF unless business_settings['availability_reminders'].enabled
 * is true; AVAILABILITY_REMINDERS_ENABLED="false" is an ops hard kill-switch. Default OFF
 * (no flag row → disabled), so deploying this is a no-op until Maarten flips it on.
 *
 * Idempotent: skips any chef who already got an 'availability_reminder' notification in the
 * last 6 days, so a re-run (or a Thursday firing + a manual run) never double-sends within a
 * week. Email via sendPlainEmail + an in-app notification (which doubles as the dedupe
 * marker) + audit. Only portal-enabled chefs (user_id IS NOT NULL) — they're the ones who
 * can actually fill it in.
 *
 * Run manually: `tsx workers/availability-reminder.ts`
 */
import { audit, log, sendPlainEmail, sql } from "./_lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

async function isEnabled(): Promise<boolean> {
  if (process.env.AVAILABILITY_REMINDERS_ENABLED === "false") return false; // hard kill-switch
  const rows = (await sql`
    SELECT value->>'enabled' AS enabled FROM business_settings WHERE key = 'availability_reminders'
  `) as Array<{ enabled: string | null }>;
  return rows[0]?.enabled === "true";
}

function emailHtml(firstName: string): string {
  const url = `${APP_URL}/chef/availability`;
  return `
    <div>
      <h1>Geef je beschikbaarheid voor volgende week door</h1>
      <p>Hé ${firstName}, wil je even checken of je beschikbaarheid voor volgende week klopt? Dan kunnen we je voor de juiste diensten inplannen.</p>
      <p><a href="${url}">Beschikbaarheid bijwerken</a></p>
      <p>Heb je niets te blokkeren? Dan hoef je niets te doen — we gaan ervan uit dat je beschikbaar bent.</p>
    </div>
  `;
}

async function main() {
  log("availability-reminder: starting");
  if (!(await isEnabled())) {
    log("availability-reminder: disabled (business_settings 'availability_reminders' off, or env kill-switch) → exiting (no sends)");
    return;
  }

  // Active, portal-enabled chefs with an email, not yet reminded in the last 6 days.
  const chefs = (await sql`
    SELECT c.id, c.user_id, c.email, c.full_name
    FROM chefs c
    WHERE c.status = 'active'
      AND c.email IS NOT NULL
      AND c.user_id IS NOT NULL
      AND c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = c.user_id
          AND n.type = 'availability_reminder'
          AND n.created_at > now() - interval '6 days'
      )
  `) as Array<{ id: string; user_id: string; email: string; full_name: string }>;

  log(`availability-reminder: ${chefs.length} chef(s) to remind`);

  let sent = 0;
  let failed = 0;
  for (const c of chefs) {
    const firstName = c.full_name.split(" ")[0] || c.full_name;
    const res = await sendPlainEmail(c.email, "Vul je beschikbaarheid voor volgende week in", emailHtml(firstName));
    if (!res.ok) {
      failed++;
      log(`  email failed for ${c.email}: ${res.error}`);
      continue;
    }
    sent++;
    // In-app notification — also the per-week dedupe marker for the next run.
    await sql`
      INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
      VALUES (
        ${c.user_id},
        'availability_reminder',
        'Beschikbaarheid volgende week',
        'Geef je beschikbaarheid voor volgende week door, dan plannen we je voor de juiste diensten.',
        '/chef/availability',
        'chef',
        ${c.id}
      )
    `;
    await audit("availability_reminder.sent", "chefs", c.id, { email: c.email });
  }

  log(`availability-reminder: done — ${sent} sent, ${failed} failed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[availability-reminder] FAILED:", err);
    process.exit(1);
  });
