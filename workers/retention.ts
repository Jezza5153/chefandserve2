/**
 * retention worker — PR-AVG-3. The ONLY hard-purger in the system.
 *
 * Enforces the storage-limitation principle (AVG art. 5(1)(e)): soft-deleted
 * records are permanently removed once they pass their retention window — but
 * NEVER while a legal hold (fiscale bewaarplicht) attaches.
 *
 * THREE-STATE SAFETY GATE (both default to safe):
 *   RETENTION_ENABLED !== "true"     → log "disabled", exit (does nothing)
 *   else RETENTION_DRY_RUN !== "false" → DRY-RUN: report candidates, delete nothing
 *   else                              → LIVE: hard-delete + purge R2
 *
 * Only acts on entity types that (a) have a row in `retention_policies` AND
 * (b) have a coded purge strategy here (chef_documents, chefs, clients —
 * the soft-deletable tables). Everything else is policy-documented only.
 *
 * Legal hold = any `shift_hours` (and, for chefs, `placements`/`ratings` that
 * the DB also RESTRICTs) referencing the subject. Held rows are skipped.
 *
 * Run: `npx tsx workers/retention.ts`  (default → "disabled", exits 0)
 */

import { audit, log, sql } from "./_lib";
import { deleteR2Object, workerR2Configured } from "./_r2";

const ENABLED = process.env.RETENTION_ENABLED === "true";
const DRY_RUN = process.env.RETENTION_DRY_RUN !== "false"; // default true (safe)

type Policy = { entity_type: string; retention_period: string };

function getPeriod(policies: Policy[], entityType: string): string | null {
  return policies.find((p) => p.entity_type === entityType)?.retention_period ?? null;
}

async function main() {
  log("retention: starting");

  // ----- gate 1: enabled -----
  if (!ENABLED) {
    log("retention: RETENTION_ENABLED != 'true' → disabled, exiting (no changes)");
    return;
  }
  // ----- gate 2: dry-run vs live -----
  const mode = DRY_RUN ? "DRY-RUN (report only)" : "LIVE (will hard-delete)";
  log(`retention: ENABLED — mode=${mode}`);
  if (!DRY_RUN && !workerR2Configured()) {
    log("retention: WARNING — R2 not configured; document bytes will NOT be purged, DB rows only.");
  }

  const policies = (await sql`SELECT entity_type, retention_period FROM retention_policies`) as Policy[];
  if (policies.length === 0) {
    log("retention: no retention_policies rows → nothing to purge. Done.");
    return;
  }

  let totalCandidates = 0;
  let totalPurged = 0;

  // ===== strategy 1: chef_documents (soft-deleted bytes + rows) =====
  {
    const period = getPeriod(policies, "chef_documents");
    if (!period) {
      log("retention: no policy for chef_documents → skipping");
    } else {
      const docs = (await sql`
        SELECT id, chef_id, r2_key, filename
        FROM chef_documents
        WHERE deleted_at IS NOT NULL
          AND (deleted_at + ${period}::interval) < now()
      `) as Array<{ id: string; chef_id: string; r2_key: string; filename: string }>;
      totalCandidates += docs.length;
      log(`retention: chef_documents — ${docs.length} expired (period ${period})`);

      if (!DRY_RUN) {
        const r2 = workerR2Configured();
        for (const d of docs) {
          if (r2) {
            try {
              await deleteR2Object(d.r2_key);
            } catch (e) {
              log(`retention: R2 delete failed for ${d.r2_key} — skipping row`, e instanceof Error ? e.message : e);
              continue; // don't delete the row if we couldn't purge the bytes
            }
          }
          await sql`DELETE FROM chef_documents WHERE id = ${d.id}`;
          await audit("retention.purge_executed", "chef_documents", d.id, {
            chefId: d.chef_id,
            filename: d.filename,
            r2Purged: r2,
          });
          totalPurged++;
        }
      }
    }
  }

  // ===== strategy 2: chefs (orphan, soft-deleted, no legal hold) =====
  {
    const period = getPeriod(policies, "chefs");
    if (!period) {
      log("retention: no policy for chefs → skipping");
    } else {
      // RESTRICT FKs (shift_hours, placements, ratings) + the fiscal hold all
      // require the chef to be free of those before a hard delete is possible.
      const chefsExpired = (await sql`
        SELECT id, full_name FROM chefs c
        WHERE deleted_at IS NOT NULL
          AND (deleted_at + ${period}::interval) < now()
          AND NOT EXISTS (SELECT 1 FROM shift_hours sh WHERE sh.chef_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.chef_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.chef_id = c.id)
      `) as Array<{ id: string; full_name: string }>;
      totalCandidates += chefsExpired.length;
      log(`retention: chefs — ${chefsExpired.length} purgeable (period ${period})`);

      if (!DRY_RUN) {
        const r2 = workerR2Configured();
        for (const c of chefsExpired) {
          // purge any remaining document bytes first (rows cascade on chef delete)
          const docs = (await sql`SELECT r2_key FROM chef_documents WHERE chef_id = ${c.id}`) as Array<{ r2_key: string }>;
          if (r2) {
            for (const d of docs) {
              try {
                await deleteR2Object(d.r2_key);
              } catch (e) {
                log(`retention: R2 delete failed for ${d.r2_key}`, e instanceof Error ? e.message : e);
              }
            }
          }
          await sql`DELETE FROM chefs WHERE id = ${c.id}`;
          await audit("retention.purge_executed", "chefs", c.id, { documents: docs.length });
          totalPurged++;
        }
      }
    }
  }

  // ===== strategy 3: clients (orphan, soft-deleted, no legal hold) =====
  {
    const period = getPeriod(policies, "clients");
    if (!period) {
      log("retention: no policy for clients → skipping");
    } else {
      const clientsExpired = (await sql`
        SELECT id, company_name FROM clients cl
        WHERE deleted_at IS NOT NULL
          AND (deleted_at + ${period}::interval) < now()
          AND NOT EXISTS (SELECT 1 FROM shift_hours sh WHERE sh.client_id = cl.id)
      `) as Array<{ id: string; company_name: string }>;
      totalCandidates += clientsExpired.length;
      log(`retention: clients — ${clientsExpired.length} purgeable (period ${period})`);

      if (!DRY_RUN) {
        for (const cl of clientsExpired) {
          await sql`DELETE FROM clients WHERE id = ${cl.id}`;
          await audit("retention.purge_executed", "clients", cl.id, { companyName: cl.company_name });
          totalPurged++;
        }
      }
    }
  }

  // ===== strategy 4: integration_outbox housekeeping (delivered breadcrumbs) =====
  // NOT PII — operational breadcrumbs. Prune rows already delivered by the
  // deliver-outbox worker (status 'sent') once past their window, so the outbox
  // doesn't grow unbounded. Raw-SQL mirror of pruneSent() in
  // src/lib/integrations/outbox.ts. Default 90d; override via a retention_policy.
  {
    const period = getPeriod(policies, "integration_outbox") ?? "90 days";
    const sentExpired = (await sql`
      SELECT id FROM integration_outbox
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND (sent_at + ${period}::interval) < now()
    `) as Array<{ id: string }>;
    totalCandidates += sentExpired.length;
    log(`retention: integration_outbox — ${sentExpired.length} delivered row(s) past ${period}`);

    if (!DRY_RUN && sentExpired.length > 0) {
      const deleted = (await sql`
        DELETE FROM integration_outbox
        WHERE status = 'sent'
          AND sent_at IS NOT NULL
          AND (sent_at + ${period}::interval) < now()
        RETURNING id
      `) as Array<{ id: string }>;
      await audit("retention.outbox_pruned", "integration_outbox", null, {
        deleted: deleted.length,
        period,
      });
      totalPurged += deleted.length;
    }
  }

  log(
    `retention: done — ${totalCandidates} candidate(s); ${DRY_RUN ? "0 purged (dry-run)" : `${totalPurged} purged`}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[retention] FAILED:", err);
    process.exit(1);
  });
