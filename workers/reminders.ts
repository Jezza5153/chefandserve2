/**
 * reminders worker — PR-REM-1.
 *
 * Daily cron (06:30 Amsterdam, after document-expiry). Evaluates every enabled
 * reminder_rules row, finds matching chefs for "today + lead_days", and fires an
 * email and/or in-app notification to the configured recipients. Idempotent via
 * the reminder_sends ledger (unique on rule_id+chef_id+occurrence_key): the row
 * insert is the gate — we only send when the insert returns a fresh id.
 *
 * Dark-launched: no-op unless REMINDERS_ENABLED=true (like the retention worker),
 * so it ships inert until a human flips the flag.
 *
 * Triggers: chef_birthday (annual; Feb-29 → Feb-28 in common years), id_document_expiry,
 * certificate_expiry, chef_inactivity (availability staleness). custom_date is reserved.
 *
 * Run manually: `npx tsx workers/reminders.ts` (or via supervisor --run-now=reminders).
 */

import { audit, log, sendPlainEmail, sql } from "./_lib";

const ENABLED = process.env.REMINDERS_ENABLED === "true";
const TZ = "Europe/Amsterdam";

type Rule = {
  id: string;
  name: string;
  trigger_type: string;
  lead_days: number | string;
  channel: string;
  recipients: string[];
  recipient_roles: string[];
  notify_subject_chef: boolean;
  params: Record<string, unknown> | string | null;
};

type Candidate = {
  chefId: string | null;
  chefUserId: string | null;
  chefEmail: string | null;
  chefName: string | null;
  targetDate: string; // YYYY-MM-DD the reminder is FOR
  occurrenceKey: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Add n days to a YYYY-MM-DD date string (pure date math, UTC-safe). */
function addDays(isoDate: string, n: number): { iso: string; y: number; m: number; d: number } {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return {
    iso: dt.toISOString().slice(0, 10),
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function asParams(p: Rule["params"]): Record<string, unknown> {
  if (!p) return {};
  if (typeof p === "string") {
    try {
      return JSON.parse(p) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return p;
}

type ChefRow = { chef_id: string; user_id: string | null; email: string | null; full_name: string | null };

function toCandidate(r: ChefRow, targetDate: string, occurrenceKey: string): Candidate {
  return {
    chefId: r.chef_id,
    chefUserId: r.user_id,
    chefEmail: r.email,
    chefName: r.full_name,
    targetDate,
    occurrenceKey,
  };
}

async function findCandidates(rule: Rule, today: string): Promise<Candidate[]> {
  const lead = Number(rule.lead_days) || 0;
  const t = addDays(today, lead);
  const params = asParams(rule.params);

  switch (rule.trigger_type) {
    case "chef_birthday": {
      const rows = (await sql`
        SELECT c.id AS chef_id, c.user_id, c.email, c.full_name
        FROM chefs c
        WHERE c.deleted_at IS NULL AND c.status <> 'archived' AND c.date_of_birth IS NOT NULL
          AND extract(month from c.date_of_birth) = ${t.m}
          AND extract(day from c.date_of_birth) = ${t.d}
      `) as ChefRow[];
      // Feb-29 birthdays in a common year → celebrate on Feb-28.
      let extra: ChefRow[] = [];
      if (t.m === 2 && t.d === 28 && !isLeap(t.y)) {
        extra = (await sql`
          SELECT c.id AS chef_id, c.user_id, c.email, c.full_name
          FROM chefs c
          WHERE c.deleted_at IS NULL AND c.status <> 'archived' AND c.date_of_birth IS NOT NULL
            AND extract(month from c.date_of_birth) = 2 AND extract(day from c.date_of_birth) = 29
        `) as ChefRow[];
      }
      return [...rows, ...extra].map((r) => toCandidate(r, t.iso, String(t.y)));
    }

    case "id_document_expiry": {
      const rows = (await sql`
        SELECT c.id AS chef_id, c.user_id, c.email, c.full_name
        FROM chefs c
        WHERE c.deleted_at IS NULL AND c.id_expires_at IS NOT NULL
          AND c.id_expires_at::date = ${t.iso}::date
      `) as ChefRow[];
      return rows.map((r) => toCandidate(r, t.iso, t.iso));
    }

    case "certificate_expiry": {
      const rows = (await sql`
        SELECT d.id AS doc_id, d.chef_id, c.user_id, c.email, c.full_name
        FROM chef_documents d
        JOIN chefs c ON c.id = d.chef_id
        WHERE d.deleted_at IS NULL AND d.status = 'verified' AND d.type = 'certificate'
          AND d.expires_at IS NOT NULL AND d.expires_at::date = ${t.iso}::date
      `) as Array<ChefRow & { doc_id: string }>;
      return rows.map((r) => toCandidate(r, t.iso, `${r.doc_id}:${t.iso}`));
    }

    case "chef_inactivity": {
      // "Inactive" = active chef with no real booking whose SHIFT falls within the
      // last `thresholdDays` (or upcoming). We key on shifts.starts_at via a
      // confirmed/completed placement — the actual work date — NOT placements.created_at
      // (proposal time, which both misses a chef still working an old recurring
      // placement and counts a chef who only ever rejected offers).
      const threshold = Number(params.thresholdDays) || 60;
      const rows = (await sql`
        SELECT c.id AS chef_id, c.user_id, c.email, c.full_name
        FROM chefs c
        WHERE c.deleted_at IS NULL AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM placements p
            JOIN shifts s ON s.id = p.shift_id
            WHERE p.chef_id = c.id
              AND p.status IN ('confirmed', 'completed')
              AND s.starts_at > now() - (${threshold} || ' days')::interval
          )
      `) as ChefRow[];
      // One inactivity ping per chef per month at most.
      return rows.map((r) => toCandidate(r, today, `${today.slice(0, 7)}`));
    }

    default:
      log(`reminders: trigger '${rule.trigger_type}' not implemented — skipping rule ${rule.name}`);
      return [];
  }
}

async function expandRoleEmails(roleKeys: string[]): Promise<string[]> {
  if (!roleKeys.length) return [];
  const rows = (await sql`
    SELECT DISTINCT u.email FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.key = ANY(${roleKeys}::text[]) AND u.status = 'active' AND u.email IS NOT NULL
  `) as Array<{ email: string }>;
  return rows.map((r) => r.email);
}

async function expandRoleUserIds(roleKeys: string[]): Promise<string[]> {
  if (!roleKeys.length) return [];
  const rows = (await sql`
    SELECT DISTINCT u.id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.key = ANY(${roleKeys}::text[]) AND u.status = 'active'
  `) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function emailContent(rule: Rule, c: Candidate): { subject: string; body: string } {
  const name = c.chefName ?? "een chef";
  const when = c.targetDate;
  switch (rule.trigger_type) {
    case "chef_birthday":
      return { subject: `🎂 ${name} is binnenkort jarig`, body: `${name} is jarig op ${when}.` };
    case "id_document_expiry":
      return { subject: `🪪 ID van ${name} verloopt`, body: `Het ID-bewijs van ${name} verloopt op ${when}.` };
    case "certificate_expiry":
      return { subject: `📄 Certificaat van ${name} verloopt`, body: `Een certificaat van ${name} verloopt op ${when}.` };
    case "chef_inactivity":
      return { subject: `💤 ${name} is al een tijd inactief`, body: `${name} is al een tijd niet ingepland voor een dienst.` };
    default:
      return { subject: `Herinnering: ${rule.name}`, body: `Herinnering voor ${name} (${when}).` };
  }
}

async function main() {
  if (!ENABLED) {
    log("reminders: disabled (set REMINDERS_ENABLED=true to activate)");
    return;
  }
  log("reminders: starting");

  const [{ today }] = (await sql`SELECT (now() AT TIME ZONE ${TZ})::date::text AS today`) as Array<{ today: string }>;
  const rules = (await sql`SELECT * FROM reminder_rules WHERE enabled = true`) as Rule[];
  log(`reminders: ${rules.length} enabled rule(s); today=${today}`);

  for (const rule of rules) {
    try {
      const candidates = await findCandidates(rule, today);
      for (const c of candidates) {
        // Idempotency gate: only send if the ledger insert is fresh.
        const inserted = (await sql`
          INSERT INTO reminder_sends (rule_id, chef_id, occurrence_key, target_date, channel, recipient_count, status)
          VALUES (${rule.id}, ${c.chefId}, ${c.occurrenceKey}, ${c.targetDate}::date, ${rule.channel}, 0, 'pending')
          ON CONFLICT DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>;
        if (inserted.length === 0) continue; // already fired this occurrence
        const sendId = inserted[0].id;

        // Resolve recipients (emails) + in-app user ids.
        const emailSet = new Set<string>();
        for (const e of rule.recipients) emailSet.add(e);
        for (const e of await expandRoleEmails(rule.recipient_roles)) emailSet.add(e);
        if (rule.notify_subject_chef && c.chefEmail) emailSet.add(c.chefEmail);
        const emails = [...emailSet].map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));

        const userIdSet = new Set<string>();
        if (rule.notify_subject_chef && c.chefUserId) userIdSet.add(c.chefUserId);
        for (const id of await expandRoleUserIds(rule.recipient_roles)) userIdSet.add(id);
        const userIds = [...userIdSet];

        const wantsEmail = rule.channel === "email" || rule.channel === "both";
        const wantsInApp = rule.channel === "in_app" || rule.channel === "both";
        const totalRecipients = (wantsEmail ? emails.length : 0) + (wantsInApp ? userIds.length : 0);

        if (totalRecipients === 0) {
          await sql`UPDATE reminder_sends SET status = 'skipped_empty' WHERE id = ${sendId}`;
          await audit("reminder.skipped_empty", "reminder_rules", rule.id, {
            chefId: c.chefId,
            occurrenceKey: c.occurrenceKey,
          });
          continue;
        }

        const { subject, body } = emailContent(rule, c);

        // sendPlainEmail never throws — it returns { ok, error }. Count failures so
        // we don't record a green 'sent' when nothing was actually delivered.
        let emailFailures = 0;
        if (wantsEmail) {
          const html = `<div><p>${body}</p><p style="color:#888;font-size:12px">Herinnering: ${rule.name} · ${Number(rule.lead_days) || 0} dag(en) vooraf</p></div>`;
          for (const to of emails) {
            const res = await sendPlainEmail(to, subject, html);
            if (!res.ok) {
              emailFailures++;
              log(`reminders: email to ${to} failed for rule '${rule.name}': ${res.error ?? "unknown"}`);
            }
          }
        }
        let inAppDelivered = 0;
        if (wantsInApp) {
          for (const uid of userIds) {
            await sql`
              INSERT INTO notifications (user_id, type, title, body, action_url, entity_type, entity_id)
              VALUES (${uid}, 'reminder', ${subject}, ${body}, ${c.chefId ? `/admin/business/chefs/${c.chefId}` : "/admin/business"}, 'reminder_rules', ${rule.id})
            `;
            inAppDelivered++;
          }
        }

        // If every email failed AND no in-app notification went out, nothing was
        // delivered — record 'error' (+ detail) rather than 'sent'. NOTE: the
        // idempotency slot is already consumed, so a hard email outage is NOT
        // auto-retried next run; status='error' + detail surface it for a human.
        const emailDelivered = wantsEmail ? emails.length - emailFailures : 0;
        const delivered = emailDelivered + inAppDelivered;
        const status = delivered > 0 ? "sent" : "error";
        await sql`UPDATE reminder_sends
          SET status = ${status}, recipient_count = ${delivered},
              detail = ${JSON.stringify({ emailDelivered, emailFailures, inAppDelivered })}::jsonb
          WHERE id = ${sendId}`;
        await audit(delivered > 0 ? "reminder.fired" : "reminder.delivery_failed", "reminder_rules", rule.id, {
          chefId: c.chefId,
          occurrenceKey: c.occurrenceKey,
          channel: rule.channel,
          emailDelivered,
          emailFailures,
          inAppDelivered,
        });
      }
      await sql`UPDATE reminder_rules SET last_run_at = now() WHERE id = ${rule.id}`;
    } catch (e) {
      log(`reminders: rule '${rule.name}' failed:`, e);
      await audit("reminder.error", "reminder_rules", rule.id, { error: String(e) }).catch(() => {});
    }
  }

  log("reminders: done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reminders] FAILED:", err);
    process.exit(1);
  });
