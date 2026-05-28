/**
 * PR-AVG-2 smoke — exercises the REAL export/erasure domain logic against a
 * throwaway data subject. Run with tsx (it imports the TS domain so the
 * redaction allow-list is genuinely tested, not re-implemented):
 *
 *     npx tsx scripts/smoke-avg-erasure.ts
 *
 * Seeds a chef subject + third-party fixtures across ≥5 tables, then asserts:
 *   - the export package CONTAINS the subject's own data
 *   - the export package EXCLUDES every third party's data (5 fixtures)
 *   - legal holds (shift_hours) are surfaced in preview + retained on erasure
 *   - erasure anonymises PII, preserves held rows, writes a tombstone
 *   - a simulated R2 failure → partially_fulfilled + failedDocuments
 *   - the tombstone is findable by the original email hash (re-import guard)
 * Self-cleaning. Safe to re-run.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Tombstone hashing needs an HMAC secret; supply a deterministic one for the
// smoke if the env doesn't have it, so re-import detection is testable locally.
if (!process.env.RATE_LIMIT_HASH_SECRET) {
  process.env.RATE_LIMIT_HASH_SECRET =
    "smoke-avg-erasure-secret-0123456789abcdefghij";
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);

const exp = await import("@/lib/domain/privacy-export");
const era = await import("@/lib/domain/privacy-erasure");
const subj = await import("@/lib/domain/privacy-subject");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

const ts = Date.now();
const uuid = () => crypto.randomUUID();

// ----- unique tokens (present vs absent assertions) -----
const SUBJECT_EMAIL = `smoke-erasure-subject-${ts}@example.com`;
const SUBJECT_NAME = `SMOKE Subject Chef ${ts}`;
const OWN_NOTE = `OWN-CHEFNOTE-${ts}`; // subject's own → MUST appear
const SECOND_CHEF_PHONE = `THIRDPARTY-PHONE-${ts}`; // named in internal comment → ABSENT
const THIRD_PARTY_EMAIL = `smoke-other-${ts}@example.com`; // other recipient → ABSENT
const AUDIT_TOKEN = `THIRDPARTY-AUDIT-${ts}`; // audit_log → ABSENT
const RATING_COMMENT = `THIRDPARTY-RATING-${ts}`; // rating free-text → ABSENT
const BILLING_TOKEN = `THIRDPARTY-BILLING-${ts}`; // integration_outbox → ABSENT

// ----- ids -----
const subjectUserId = uuid();
const actorUserId = uuid();
const otherUserId = uuid();
const subjectChefId = uuid();
const secondChefId = uuid();
const clientId = uuid();
const shiftId = uuid();
const placementId = uuid();
const docId = uuid();
let reqId: string | null = null;

console.log("=== PR-AVG-2 export + erasure smoke ===\n");

try {
  console.log("── seed throwaway subject + third-party fixtures ──");

  // users: subject (chef), actor (admin), other (third party)
  await sql`INSERT INTO users (id, email, name, kind, status) VALUES
    (${subjectUserId}, ${SUBJECT_EMAIL}, ${SUBJECT_NAME}, 'chef', 'active'),
    (${actorUserId}, ${`smoke-actor-${ts}@example.com`}, 'SMOKE Actor', 'internal', 'active'),
    (${otherUserId}, ${THIRD_PARTY_EMAIL}, 'SMOKE Other Person', 'chef', 'active')`;

  // chefs: subject (linked) + a second chef (third party, phone = fixture)
  await sql`INSERT INTO chefs (id, user_id, full_name, email, phone, city, status) VALUES
    (${subjectChefId}, ${subjectUserId}, ${SUBJECT_NAME}, ${SUBJECT_EMAIL}, '0600000001', 'Amsterdam', 'active')`;
  await sql`INSERT INTO chefs (id, full_name, phone, status) VALUES
    (${secondChefId}, 'SMOKE Second Chef', ${SECOND_CHEF_PHONE}, 'active')`;

  // client + shift + placement
  await sql`INSERT INTO clients (id, company_name, status) VALUES (${clientId}, ${`SMOKE Hotel ${ts}`}, 'active')`;
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, status) VALUES
    (${shiftId}, ${clientId}, now(), now() + interval '5 hours', 'chef_de_partie', 'completed')`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
    (${placementId}, ${shiftId}, ${subjectChefId}, 'confirmed')`;

  // shift_hours: subject's OWN pay evidence (legal hold) + own note anchor
  await sql`INSERT INTO shift_hours
    (placement_id, shift_id, chef_id, client_id, started_at, ended_at, break_minutes, worked_minutes, chef_rate_cents, client_rate_cents, chef_notes, status)
    VALUES (${placementId}, ${shiftId}, ${subjectChefId}, ${clientId}, now(), now() + interval '5 hours', 30, 270, 2500, 4500, ${OWN_NOTE}, 'admin_approved')`;

  // chef_documents — drives the R2 erase path + manifest
  await sql`INSERT INTO chef_documents (id, chef_id, type, filename, r2_key, status) VALUES
    (${docId}, ${subjectChefId}, 'cv', 'cv.pdf', ${`chefs/${subjectChefId}/${docId}/cv.pdf`}, 'verified')`;

  // FIXTURE 1 — internal comment naming the 2nd chef's phone (must be excluded)
  await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body) VALUES
    (${placementId}, 'admin', 'internal', ${`Tweede chef bereikbaar op ${SECOND_CHEF_PHONE}`})`;

  // FIXTURE 2 — email to a third party (must be excluded); one to subject (included)
  await sql`INSERT INTO email_messages (to_email, template, status) VALUES
    (${THIRD_PARTY_EMAIL}, 'SomeOtherEmail', 'sent'),
    (${SUBJECT_EMAIL}, 'ShiftConfirmedEmail', 'sent')`;

  // FIXTURE 3 — audit_log row about another user (audit_log is excluded wholesale)
  await sql`INSERT INTO audit_log (user_id, action, resource, resource_id) VALUES
    (${otherUserId}, ${AUDIT_TOKEN}, 'chefs', ${secondChefId})`;

  // FIXTURE 4 — rating with a third-party comment (only aggregate is exported)
  await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars, comment) VALUES
    (${placementId}, ${subjectChefId}, ${clientId}, 4, ${RATING_COMMENT})`;

  // FIXTURE 5 — integration_outbox carrying client billing (never exported)
  await sql`INSERT INTO integration_outbox (provider, event_type, entity_type, entity_id, payload_json, idempotency_key) VALUES
    ('payingit', 'invoice.created', 'client', ${clientId}, ${JSON.stringify({ billing: BILLING_TOKEN })}, ${`smoke-${ts}`})`;

  // the deletion request (identity verified so erasure is allowed)
  const due = new Date(Date.now() + 30 * 864e5).toISOString();
  const [{ id }] = await sql`INSERT INTO privacy_requests
    (user_id, type, status, due_date, requester_kind, requester_email, original_channel, identity_status, identity_verified_at)
    VALUES (${subjectUserId}, 'deletion', 'in_progress', ${due}, 'chef', ${SUBJECT_EMAIL}, 'portal', 'verified', now())
    RETURNING id` as { id: string }[];
  reqId = id;
  assert("seed complete (subject + 5 third-party fixtures + request)", Boolean(reqId));

  // ===== EXPORT REDACTION =====
  console.log("\n── export: redaction allow-list ──");
  const subject = await subj.resolveSubject({
    userId: subjectUserId,
    requesterEmail: SUBJECT_EMAIL,
  });
  assert("resolveSubject finds the chef", subject.kind === "chef" && subject.chefId === subjectChefId);

  const preview = await exp.previewUserDataExport(subject);
  assert(
    "preview surfaces shift_hours legal hold",
    preview.legalHolds.some((h) => h.entityType === "shift_hours"),
  );
  assert("preview lists redactions", preview.redactions.length > 0);
  assert("preview includes profile + hours tables", preview.tablesIncluded.includes("profile") && preview.tablesIncluded.includes("hours"));

  const data = await exp.collectUserData(subject);
  const files = await exp.buildExportFiles(data, {
    handlerName: "SMOKE Actor",
    presign: async (key) => `https://r2.example/${key}?sig=stub`,
  });
  const blob = Object.values(files).join("\n");

  // own data present
  assert("export CONTAINS subject name", blob.includes(SUBJECT_NAME));
  assert("export CONTAINS subject's own chef note", blob.includes(OWN_NOTE));
  // third-party data absent
  assert("export EXCLUDES 2nd chef's phone (internal comment)", !blob.includes(SECOND_CHEF_PHONE));
  assert("export EXCLUDES third party's email (other recipient)", !blob.includes(THIRD_PARTY_EMAIL));
  assert("export EXCLUDES audit_log content (other user)", !blob.includes(AUDIT_TOKEN));
  assert("export EXCLUDES raw rating comment (aggregate only)", !blob.includes(RATING_COMMENT));
  assert("export EXCLUDES integration_outbox billing payload", !blob.includes(BILLING_TOKEN));
  // package shape
  assert("export has all 4 files", exp.EXPORT_FILE_NAMES.every((f) => f in files));
  assert("manifest lists the chef document with a (stub) link", files["documents-manifest.json"].includes("cv.pdf") && files["documents-manifest.json"].includes("sig=stub"));

  // ===== ERASURE =====
  console.log("\n── erasure: legal-hold-aware + tombstone ──");
  const ePrev = await era.previewUserErasure(subject);
  assert("erase preview retains shift_hours", ePrev.willRetain.some((h) => h.entityType === "shift_hours"));
  assert("erase preview will anonymise chefs", ePrev.willErase.some((i) => i.table === "chefs"));
  assert("erase preview counts 1 document", ePrev.documentCount === 1);

  // simulate an R2 failure for the doc
  const result = await era.eraseUserData({
    requestId: reqId,
    actorId: actorUserId,
    reason: "SMOKE erasure",
    deleteObjectFn: async () => {
      throw new Error("simulated R2 failure");
    },
  });
  assert("erase returned ok", result.ok === true);
  if (result.ok) {
    assert("erase outcome = partially_fulfilled (hold + R2 fail)", result.outcome === "partially_fulfilled");
    assert("erase reported 1 failed document", result.failedDocuments === 1);
    assert("erase retained shift_hours", result.retained.some((h) => h.entityType === "shift_hours"));
    assert("erase wrote a tombstone", Boolean(result.tombstoneId));
  }

  // verify DB state
  const [chefRow] = await sql`SELECT full_name, email, deleted_at FROM chefs WHERE id=${subjectChefId}` as { full_name: string; email: string | null; deleted_at: string | null }[];
  assert("chef PII anonymised (name + email)", chefRow.full_name === "Verwijderde chef" && chefRow.email === null);
  assert("chef soft-deleted (deleted_at set)", chefRow.deleted_at !== null);

  const heldHours = await sql`SELECT id FROM shift_hours WHERE chef_id=${subjectChefId}`;
  assert("held shift_hours row PRESERVED (legal hold)", heldHours.length === 1);

  const [userRow] = await sql`SELECT email, status, totp_enabled FROM users WHERE id=${subjectUserId}` as { email: string; status: string; totp_enabled: boolean }[];
  assert("user account anonymised + disabled", userRow.email === `deleted-${subjectUserId}@erased.invalid` && userRow.status === "disabled");

  const [docRow] = await sql`SELECT deleted_at FROM chef_documents WHERE id=${docId}` as { deleted_at: string | null }[];
  assert("chef_document soft-deleted", docRow.deleted_at !== null);

  const tombByEmail = await subj.findTombstoneByEmail(SUBJECT_EMAIL);
  assert("tombstone findable by original email hash (re-import guard)", Boolean(tombByEmail) && tombByEmail!.originalUserId === subjectUserId);

  const [reqRow] = await sql`SELECT status FROM privacy_requests WHERE id=${reqId}` as { status: string }[];
  assert("request closed as partially_fulfilled", reqRow.status === "partially_fulfilled");
} finally {
  console.log("\n── cleanup ──");
  if (reqId) {
    await sql`DELETE FROM privacy_erasure_tombstones WHERE privacy_request_id=${reqId} OR original_user_id=${subjectUserId}`;
    await sql`DELETE FROM ratings WHERE chef_id IN (${subjectChefId}, ${secondChefId})`;
    await sql`DELETE FROM shift_hours WHERE chef_id=${subjectChefId}`;
    await sql`DELETE FROM placement_comments WHERE placement_id=${placementId}`;
    await sql`DELETE FROM placements WHERE id=${placementId}`;
    await sql`DELETE FROM shifts WHERE id=${shiftId}`;
    await sql`DELETE FROM chef_documents WHERE chef_id=${subjectChefId}`;
    await sql`DELETE FROM chef_availability WHERE chef_id=${subjectChefId}`;
    await sql`DELETE FROM chefs WHERE id IN (${subjectChefId}, ${secondChefId})`;
    await sql`DELETE FROM clients WHERE id=${clientId}`;
    await sql`DELETE FROM email_messages WHERE to_email IN (${SUBJECT_EMAIL}, ${THIRD_PARTY_EMAIL})`;
    await sql`DELETE FROM integration_outbox WHERE idempotency_key=${`smoke-${ts}`}`;
    await sql`DELETE FROM audit_log WHERE resource_id=${reqId} OR action=${AUDIT_TOKEN} OR user_id IN (${subjectUserId}, ${actorUserId}, ${otherUserId})`;
    await sql`DELETE FROM notifications WHERE user_id IN (${subjectUserId}, ${actorUserId})`;
    await sql`DELETE FROM privacy_requests WHERE id=${reqId}`;
    await sql`DELETE FROM users WHERE id IN (${subjectUserId}, ${actorUserId}, ${otherUserId})`;
    const [gone] = await sql`SELECT id FROM privacy_requests WHERE id=${reqId}`;
    assert("cleanup removed all smoke rows", !gone);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
