/**
 * hours-reminders worker — PR-AUDIT-6.
 *
 * The escalation ladder for the hours trust chain (WORKFLOW §2.1). Three tiers,
 * each idempotent — an audit_log breadcrumb per (hours row, stage) is the marker
 * so a re-run never double-sends (the document-expiry.ts idiom; no schema change):
 *
 *   TIER 1 — chef hasn't submitted   (shift_hours.status = 'draft')
 *     +24h after the draft was auto-created → nudge chef   (email + notification)
 *     +72h still draft                      → second, firmer chef nudge
 *
 *   TIER 2 — klant hasn't signed     (shift_hours.status = 'submitted')
 *     +5d after submit  → remind the klant to sign         (email + notification)
 *
 *   TIER 3 — klant STILL hasn't signed
 *     +10d after submit → alert admin: force-approve needed (email)
 *
 * GATED: HOURS_REMINDERS_ENABLED !== "true" → logs "disabled", exits (no sends).
 * Default-off is deliberate — this is the ONLY worker that emails klanten/chefs
 * about their own rows, so it must not fire against demo / pre-launch data until
 * a human flips it on at launch. (Mirrors retention.ts / reminders.ts dark-launch.)
 *
 * Boundary vs reminders.ts (PR-REM-1): that is the GENERIC configurable rule
 * engine (reminder_rules); this is the FIXED hours ladder. Keep hours rules OUT
 * of reminder_rules so the two can't double-send if both are enabled.
 *
 * Run: `npx tsx workers/hours-reminders.ts`  (default → "disabled", exits 0)
 */

import { audit, log, sendPlainEmail, sql } from "./_lib";

const ENABLED = process.env.HOURS_REMINDERS_ENABLED === "true";
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://chefandserve2.vercel.app";

/* ---------- helpers ------------------------------------------------------- */

/** recipientsFor() in raw SQL: the admin route row (if enabled) else MAARTEN_EMAIL. */
async function adminRecipients(event: string): Promise<string[]> {
  const rows = (await sql`
    SELECT recipients, enabled FROM notification_routes WHERE event = ${event} LIMIT 1
  `) as Array<{ recipients: string[]; enabled: boolean }>;
  const row = rows[0];
  if (row && row.enabled && Array.isArray(row.recipients) && row.recipients.length > 0) {
    return row.recipients;
  }
  const m = process.env.MAARTEN_EMAIL?.trim();
  return m ? [m] : [];
}

/** Has a reminder already fired for this hours row at this stage? (idempotency) */
async function alreadySent(hoursId: string, action: string, stage: string): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM audit_log
    WHERE resource = 'shift_hours'
      AND resource_id = ${hoursId}
      AND action = ${action}
      AND after->>'stage' = ${stage}
    LIMIT 1
  `) as Array<unknown>;
  return rows.length > 0;
}

async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  actionUrl: string,
  hoursId: string,
): Promise<void> {
  await sql`
    INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
    VALUES (${userId}, ${type}, ${title}, ${body}, ${actionUrl}, 'shift_hours', ${hoursId})
  `;
}

function shell(heading: string, lines: string[], cta: { href: string; label: string }): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#29292A">
      <h2 style="color:#801B2B;font-size:20px">${heading}</h2>
      ${lines.map((l) => `<p style="font-size:15px;line-height:1.5">${l}</p>`).join("")}
      <p style="margin-top:24px">
        <a href="${cta.href}" style="background:#801B2B;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-size:15px">${cta.label}</a>
      </p>
    </div>`;
}

/* ---------- TIER 1 — chef nudges (draft) ---------------------------------- */

async function chefNudges(): Promise<{ sent: number }> {
  const rows = (await sql`
    SELECT sh.id, sh.placement_id, sh.created_at,
           c.email AS chef_email, c.user_id AS chef_user_id, c.full_name AS chef_name,
           cl.company_name
    FROM shift_hours sh
    INNER JOIN chefs c    ON c.id = sh.chef_id
    INNER JOIN clients cl ON cl.id = sh.client_id
    WHERE sh.status = 'draft'
      AND sh.created_at < now() - interval '24 hours'
    ORDER BY sh.created_at ASC
  `) as Array<{
    id: string;
    placement_id: string;
    created_at: string;
    chef_email: string | null;
    chef_user_id: string | null;
    chef_name: string;
    company_name: string | null;
  }>;

  let sent = 0;
  for (const r of rows) {
    const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
    const stage = ageH >= 72 ? "72h" : "24h";
    if (await alreadySent(r.id, "shift_hours.reminder_chef", stage)) continue;

    const where = r.company_name ?? "een klant";
    const url = `${APP}/chef/hours/${r.placement_id}`;
    const subject =
      stage === "72h"
        ? `Herinnering: dien je uren nog in — ${where}`
        : `Vergeet je uren niet in te dienen — ${where}`;
    const html = shell(
      stage === "72h" ? "Je uren staan nog open" : "Dien je gewerkte uren in",
      [
        `Hoi ${r.chef_name},`,
        `Je shift bij <strong>${where}</strong> is afgerond, maar we hebben je uren nog niet binnen. Dien ze in zodat ze getekend en uitbetaald kunnen worden.`,
        stage === "72h" ? "Dit is de tweede herinnering — graag deze week indienen." : "",
      ].filter(Boolean),
      { href: url, label: "Uren indienen" },
    );

    if (r.chef_email) {
      const res = await sendPlainEmail(r.chef_email, subject, html);
      if (!res.ok) log(`hours-reminders: chef email failed (${r.id}): ${res.error}`);
    }
    if (r.chef_user_id) {
      await notify(
        r.chef_user_id,
        "hours_reminder_chef",
        "Dien je uren in",
        `Je uren voor ${where} staan nog open.`,
        `/chef/hours/${r.placement_id}`,
        r.id,
      );
    }
    await audit("shift_hours.reminder_chef", "shift_hours", r.id, {
      stage,
      placementId: r.placement_id,
    });
    sent++;
  }
  log(`hours-reminders: chef nudges sent ${sent}`);
  return { sent };
}

/* ---------- TIER 2 + 3 — klant reminder (5d) / admin alert (10d) ----------- */

async function klantAndAdmin(): Promise<{ klant: number; admin: number }> {
  // LEFT JOIN the klant's notification_prefs so the 5d email honors the
  // 'hours_ready_to_sign' opt-out (AI_INTEGRATION: every worker send path
  // inherits the opt-out — same rule as recipientsForClient/shouldSendToUser).
  const rows = (await sql`
    SELECT sh.id, sh.shift_id, sh.submitted_at,
           cl.email AS klant_email, cl.billing_email, cl.user_id AS klant_user_id,
           cl.company_name, c.full_name AS chef_name,
           (np.prefs->>'hours_ready_to_sign') AS klant_hours_pref
    FROM shift_hours sh
    INNER JOIN clients cl ON cl.id = sh.client_id
    INNER JOIN chefs c    ON c.id = sh.chef_id
    LEFT JOIN notification_prefs np ON np.user_id = cl.user_id
    WHERE sh.status = 'submitted'
      AND sh.submitted_at < now() - interval '5 days'
    ORDER BY sh.submitted_at ASC
  `) as Array<{
    id: string;
    shift_id: string;
    submitted_at: string;
    klant_email: string | null;
    billing_email: string | null;
    klant_user_id: string | null;
    company_name: string | null;
    chef_name: string;
    klant_hours_pref: string | null;
  }>;

  const adminTo = await adminRecipients("hours_admin_force_approve_needed");
  let klant = 0;
  let admin = 0;

  for (const r of rows) {
    const ageD = (Date.now() - new Date(r.submitted_at).getTime()) / 86_400_000;
    const company = r.company_name ?? "een klant";

    // TIER 3 first — once a row crosses 10 days, escalate to admin (not the klant).
    if (ageD >= 10) {
      if (await alreadySent(r.id, "shift_hours.reminder_klant", "admin_10d")) continue;
      const subject = `Actie nodig: uren ${company} ${Math.floor(ageD)} dagen niet getekend`;
      const html = shell(
        "Klant tekent de uren niet — keur ze handmatig",
        [
          `De uren van <strong>${r.chef_name}</strong> bij <strong>${company}</strong> staan al ${Math.floor(ageD)} dagen op 'ingediend' zonder klant-handtekening.`,
          "Keur ze handmatig goed of neem contact op met de klant.",
        ],
        { href: `${APP}/admin/business/hours`, label: "Naar urenbeheer" },
      );
      for (const to of adminTo) {
        const res = await sendPlainEmail(to, subject, html);
        if (!res.ok) log(`hours-reminders: admin email failed (${r.id}): ${res.error}`);
      }
      await audit("shift_hours.reminder_klant", "shift_hours", r.id, {
        stage: "admin_10d",
        company,
      });
      admin++;
      continue;
    }

    // TIER 2 — 5–10 day window: remind the klant to sign.
    if (await alreadySent(r.id, "shift_hours.reminder_klant", "klant_5d")) continue;
    const to = r.klant_email ?? r.billing_email;
    // Honor the klant's 'hours_ready_to_sign' email opt-out (mute = explicit
    // 'false'). The in-app notification + 10d admin escalation still fire.
    const emailMuted = r.klant_hours_pref === "false";
    const url = `${APP}/client/shifts/${r.shift_id}/hours`;
    const subject = `Herinnering: teken de uren van ${r.chef_name}`;
    const html = shell(
      "Teken de gewerkte uren",
      [
        `De uren van <strong>${r.chef_name}</strong> wachten op je handtekening.`,
        "Controleer en teken ze, dan ronden we de verwerking en facturatie af.",
      ],
      { href: url, label: "Uren bekijken en tekenen" },
    );
    if (to && !emailMuted) {
      const res = await sendPlainEmail(to, subject, html);
      if (!res.ok) log(`hours-reminders: klant email failed (${r.id}): ${res.error}`);
    } else if (emailMuted) {
      log(`hours-reminders: klant ${r.id} muted hours email — in-app only`);
    }
    if (r.klant_user_id) {
      await notify(
        r.klant_user_id,
        "hours_reminder_klant",
        "Teken de uren",
        `De uren van ${r.chef_name} wachten op je handtekening.`,
        `/client/shifts/${r.shift_id}/hours`,
        r.id,
      );
    }
    await audit("shift_hours.reminder_klant", "shift_hours", r.id, {
      stage: "klant_5d",
      company,
    });
    klant++;
  }
  log(`hours-reminders: klant reminders ${klant}, admin alerts ${admin}`);
  return { klant, admin };
}

/* ---------- main ---------------------------------------------------------- */

async function main() {
  log("hours-reminders: starting");
  if (!ENABLED) {
    log("hours-reminders: HOURS_REMINDERS_ENABLED != 'true' → disabled, exiting (no sends)");
    return;
  }
  const chef = await chefNudges();
  const ka = await klantAndAdmin();
  log(
    `hours-reminders: done — ${chef.sent} chef, ${ka.klant} klant, ${ka.admin} admin`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[hours-reminders] FAILED:", err);
    process.exit(1);
  });
