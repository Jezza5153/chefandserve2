/**
 * Weekly digest — Monday 8am.
 *
 * Emails Maarten a summary of:
 *   - New chef/client submissions in the last 7 days
 *   - Shifts confirmed
 *   - Open shifts needing chefs
 *   - Hours waiting approval
 */
import { sql, sendPlainEmail, audit, log, fmtDate } from "./_lib";

async function main() {
  log("weekly-digest start");
  const recipient = process.env.MAARTEN_EMAIL;
  if (!recipient) {
    log("MAARTEN_EMAIL not set — skipping");
    process.exit(0);
  }

  // Last 7 days window
  const newChefs = await sql`
    SELECT count(*)::int AS n FROM chef_submissions WHERE created_at > now() - interval '7 days'
  `;
  const newClients = await sql`
    SELECT count(*)::int AS n FROM client_submissions WHERE created_at > now() - interval '7 days'
  `;
  const openShifts = await sql`
    SELECT count(*)::int AS n FROM shifts WHERE status = 'open' AND starts_at > now()
  `;
  const upcomingConfirmed = await sql`
    SELECT count(*)::int AS n FROM placements
    WHERE status = 'confirmed' AND created_at > now() - interval '7 days'
  `;
  const next7Shifts = await sql`
    SELECT s.role_needed, s.starts_at, c.company_name
    FROM shifts s
    INNER JOIN clients c ON c.id = s.client_id
    WHERE s.starts_at BETWEEN now() AND now() + interval '7 days'
      AND s.status != 'cancelled'
    ORDER BY s.starts_at
    LIMIT 10
  `;

  // Money + KPIs from the nightly metrics snapshot (client_metrics_daily) +
  // the "te factureren" backlog (approved hours not yet on an invoice).
  const thisWeek = await sql`
    SELECT COALESCE(SUM(spend_cents),0)::bigint AS rev,
           COALESCE(SUM(margin_cents),0)::bigint AS margin,
           COALESCE(SUM(filled_slots),0)::int AS filled,
           COALESCE(SUM(slots_count),0)::int AS slots
    FROM client_metrics_daily WHERE snapshot_date > current_date - 7
  `;
  const prevWeek = await sql`
    SELECT COALESCE(SUM(spend_cents),0)::bigint AS rev
    FROM client_metrics_daily
    WHERE snapshot_date > current_date - 14 AND snapshot_date <= current_date - 7
  `;
  const unbilled = await sql`
    SELECT COALESCE(SUM(ROUND(sh.worked_minutes / 60.0 * sh.client_rate_cents)),0)::bigint AS cents
    FROM shift_hours sh
    LEFT JOIN invoice_lines il ON il.shift_hours_id = sh.id
    WHERE sh.status = 'admin_approved' AND il.id IS NULL
  `;
  const topClient = await sql`
    SELECT c.company_name AS name, COALESCE(SUM(cmd.spend_cents),0)::bigint AS rev
    FROM client_metrics_daily cmd INNER JOIN clients c ON c.id = cmd.client_id
    WHERE cmd.snapshot_date > current_date - 7
    GROUP BY c.company_name ORDER BY rev DESC LIMIT 1
  `;

  const eur = (cents: number) =>
    `€${(Number(cents) / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const revNow = Number(thisWeek[0]?.rev ?? 0);
  const revPrev = Number(prevWeek[0]?.rev ?? 0);
  const revDeltaPct = revPrev > 0 ? Math.round(((revNow - revPrev) / revPrev) * 100) : null;
  const slots = Number(thisWeek[0]?.slots ?? 0);
  const filled = Number(thisWeek[0]?.filled ?? 0);
  const fillPct = slots > 0 ? Math.round((filled / slots) * 100) : null;
  const deltaLabel =
    revDeltaPct == null
      ? ""
      : revDeltaPct >= 0
        ? ` (▲ ${revDeltaPct}% t.o.v. vorige week)`
        : ` (▼ ${Math.abs(revDeltaPct)}% t.o.v. vorige week)`;
  const unbilledCents = Number(unbilled[0]?.cents ?? 0);

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h1 style="font-family: Georgia, serif; color: #29292A;">Chef &amp; Serve — weekoverzicht</h1>
      <p style="color: #29292A;">Hier is je samenvatting van de afgelopen 7 dagen:</p>

      <ul style="line-height: 1.8; color: #29292A;">
        <li><strong>${newChefs[0]?.n ?? 0}</strong> nieuwe chef-aanmeldingen</li>
        <li><strong>${newClients[0]?.n ?? 0}</strong> nieuwe klant-aanvragen</li>
        <li><strong>${openShifts[0]?.n ?? 0}</strong> open shifts (wachten op chef)</li>
        <li><strong>${upcomingConfirmed[0]?.n ?? 0}</strong> nieuwe bevestigde plaatsingen</li>
      </ul>

      <h2 style="font-family: Georgia, serif; color: #29292A; margin-top: 32px;">Geld &amp; KPI's (deze week)</h2>
      <ul style="line-height: 1.8; color: #29292A;">
        <li>Omzet: <strong>${eur(revNow)}</strong>${deltaLabel}</li>
        <li>Marge: <strong>${eur(Number(thisWeek[0]?.margin ?? 0))}</strong></li>
        <li>Bezettingsgraad: <strong>${fillPct == null ? "—" : `${fillPct}%`}</strong></li>
        <li>Te factureren: <strong>${eur(unbilledCents)}</strong> aan goedgekeurde uren</li>
        ${
          topClient[0] && Number(topClient[0].rev) > 0
            ? `<li>Grootste klant: <strong>${topClient[0].name}</strong> (${eur(Number(topClient[0].rev))})</li>`
            : ""
        }
      </ul>

      <h2 style="font-family: Georgia, serif; color: #29292A; margin-top: 32px;">Komende 7 dagen</h2>
      <ul style="line-height: 1.8; color: #29292A;">
        ${next7Shifts
          .map(
            (s) =>
              `<li>${fmtDate(s.starts_at)} — ${s.role_needed} @ ${s.company_name}</li>`,
          )
          .join("")}
        ${next7Shifts.length === 0 ? "<li>Geen shifts ingepland.</li>" : ""}
      </ul>

      <p style="margin-top: 32px; color: #29292A;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app"}/admin/business"
           style="background: #801B2B; color: #fff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;">
          Open dashboard
        </a>
        &nbsp;&nbsp;
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app"}/admin/business/reporting"
           style="display: inline-block; border: 1px solid #801B2B; color: #801B2B; padding: 11px 20px; border-radius: 999px; text-decoration: none; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;">
          Bekijk rapportage
        </a>
      </p>

      <p style="margin-top: 32px; font-size: 11px; color: #888;">
        Verstuurd door de weekly-digest worker · ${new Date().toLocaleString("nl-NL")}
      </p>
    </div>
  `;

  const result = await sendPlainEmail(
    recipient,
    "Chef & Serve — weekoverzicht",
    html,
  );

  if (result.ok) {
    log(`digest sent to ${recipient}`);
    await audit("worker.weekly_digest", "system", null, {
      recipient,
      newChefs: newChefs[0]?.n,
      newClients: newClients[0]?.n,
      revenueCents: revNow,
      unbilledCents,
    });
    process.exit(0);
  } else {
    log(`digest FAILED: ${result.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  log("worker crashed:", e);
  process.exit(1);
});
