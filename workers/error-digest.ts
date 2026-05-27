/**
 * Error digest — 7am daily.
 *
 * Emails Jezza (super_admin) if there were any errors in the last 24h.
 * Skips the send if there's nothing — no inbox spam for clean days.
 */
import { sql, sendPlainEmail, log, fmtDate } from "./_lib";

async function main() {
  log("error-digest start");
  const recipient = process.env.JEZZA_EMAIL;
  if (!recipient) {
    log("JEZZA_EMAIL not set — skipping");
    process.exit(0);
  }

  const errors = (await sql`
    SELECT id, message, severity, url, user_id, created_at, resolved_at
    FROM error_log
    WHERE created_at > now() - interval '24 hours'
    ORDER BY created_at DESC
    LIMIT 50
  `) as Array<{
    id: string;
    message: string;
    severity: string;
    url: string | null;
    user_id: string | null;
    created_at: string;
    resolved_at: string | null;
  }>;

  if (errors.length === 0) {
    log("Geen errors in 24h — geen mail");
    process.exit(0);
  }

  const unresolved = errors.filter((e) => !e.resolved_at).length;
  const critical = errors.filter((e) => e.severity === "critical").length;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h1 style="font-family: Georgia, serif; color: #29292A;">
        🐛 Chef &amp; Serve — error digest
      </h1>
      <p style="color: #29292A;">
        Laatste 24 uur: <strong>${errors.length} errors</strong>,
        ${unresolved} open, ${critical} critical.
      </p>

      <ul style="line-height: 1.6; color: #29292A; font-size: 13px;">
        ${errors
          .slice(0, 20)
          .map(
            (e) =>
              `<li>
                <strong>${e.severity.toUpperCase()}</strong> · ${fmtDate(e.created_at)} ·
                ${e.url ?? ""}
                <br/><span style="color: #555;">${e.message.slice(0, 200)}</span>
              </li>`,
          )
          .join("")}
      </ul>

      <p style="margin-top: 24px;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app"}/admin/system/errors"
           style="background: #801B2B; color: #fff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;">
          Open errors-dashboard
        </a>
      </p>
    </div>
  `;

  const result = await sendPlainEmail(
    recipient,
    `🐛 Chef & Serve — ${errors.length} errors (${unresolved} open)`,
    html,
  );

  log(`digest send: ${result.ok ? "ok" : `fail ${result.error}`}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
