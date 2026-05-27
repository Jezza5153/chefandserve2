# Workflow: Payroll export (CSV batch)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.1 final stage**. Ships with PR-CHEF-7.

## Purpose

Move all `admin_approved` `shift_hours` rows for a period into an immutable batch, generate a CSV file, upload to R2, and mark the rows `exported`. After export, the rows are append-only — any change requires `shift_hour_corrections` (see [`hours-trust-chain.md`](./hours-trust-chain.md)).

This is the bridge between the trust chain and the external payroll provider (Payingit, today). V1 uses CSV download/upload; future PR adds live API.

The append-only invariant is the single hardest line in the system. Once a row is `exported`, NO mutation of that row is allowed. The AI must enforce this and the DB layer enforces it via check + atomic guards.

---

## Actors

- **Admin (`owner`+, future `bookkeeper`)** — creates the batch, exports, confirms.
- **System** — atomically transitions rows, writes file to R2, computes sha256 checksum, records run.
- **Payingit (external)** — receives the CSV (today out-of-band; future via API).

---

## Source tables

- `shift_hours` — rows where `status='admin_approved'`. After export → `status='exported'` + `payingitExportedAt`.
- `shift_hour_corrections` — append-only delta rows for any post-export adjustment.
- `payroll_batches` — the export grouping (`status`: `draft` · `exported` · `voided`).
- `payroll_batch_lines` — one row per included `shift_hours`.
- R2 bucket `chefandserve` — `payroll/<year>/<batchId>.csv`.
- `integration_outbox` — `payroll_batch.exported` event.
- `notifications`, `audit_log`.

---

## Human status labels

`payroll_batches.status`:

| Backend | Dutch label |
|---|---|
| `draft` | "Concept" |
| `exported` | "Geëxporteerd" |
| `voided` | "Geannuleerd" |

`shift_hours.status` post-export:

| Backend | Dutch label |
|---|---|
| `exported` | "Verwerkt voor uitbetaling" |

---

## Allowed transitions

### Batch lifecycle

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `draft` | admin (`owner`+) | period (start, end) specified; picks all `admin_approved` rows in window | `createPayrollBatch(periodStart, periodEnd)` |
| `draft` | `exported` | admin (`owner`+) | batch is `draft`; all linked rows still `admin_approved`; CSV generated + uploaded + sha256 computed | `exportPayrollBatch(batchId)` (single atomic transaction) |
| `draft` | `voided` | admin (`owner`+) | batch is `draft`; rare | `voidPayrollBatch(batchId, reason)` |
| `exported` | (terminal) | — | — | NO mutation allowed |

### Row lifecycle (per row in the batch)

| From | To | When |
|---|---|---|
| `admin_approved` | `exported` | atomically, as part of `exportPayrollBatch` |

The export is a single transaction that:
1. Locks the rows (`FOR UPDATE`).
2. Verifies all are still `admin_approved`.
3. Updates each to `exported` + sets `payingitExportedAt`.
4. Updates batch row: `status='exported'`, `fileUrl`, `fileChecksum`, `exportedAt`, `exportedBy`.
5. Inserts outbox row `payroll_batch.exported` with idempotency key `payroll_batch.exported:<batchId>`.

If any row has moved out of `admin_approved` (e.g. admin voided it), the export aborts with a stale-row error. Admin re-creates the batch.

---

## CSV format

Columns (v1):

```
shift_hours_id, chef_id, chef_payingit_employee_id, client_id, shift_date,
worked_minutes, break_minutes, chef_rate_cents, chef_amount_cents,
period_start, period_end, batch_id, correction_for_hours_id (nullable),
correction_delta_minutes (nullable), correction_reason (nullable)
```

Encoding: UTF-8, CRLF line endings, RFC 4180 quoting. First row is header.

Filename pattern: `chefserve-payroll-{periodStart YYYYMMDD}-{periodEnd YYYYMMDD}-{batchId short8}.csv`

Checksum: sha256 hex; recorded in `payroll_batches.fileChecksum`. Used to detect tampering.

---

## AI can read

Through `payroll.draft_batch`, `integrations.health`:

- Pending `admin_approved` rows for a period.
- Existing batches (status + counts + total amount).
- Per-chef breakdown for a batch.
- Recent corrections waiting for next batch.

---

## AI can draft

- **Batch preview**: "Voor mei 2026 zijn er 47 admin_approved rijen, totaal €X. Wil je een batch aanmaken?" — AI shows the list, totals, and any concerns (e.g. "1 rij heeft een correctie openstaan — wacht op tweede admin").
- **CSV preview**: "Hier zijn de eerste 5 regels van de CSV — controleer of alles klopt." (Read-only view of what would be written.)
- **Recipient list**: "X klanten, Y chefs zullen na export een email krijgen."
- **Anomaly summary**: "47 rijen, geen schedule-deviation flags overgebleven. 1 rate-override (Daniel @ Lute, €25 vs €22)."

---

## AI can execute only after explicit human confirmation

- **`payroll.draft_batch`** — admin clicks "Maak conceptbatch". Audit: `ai.payroll.draft_batch` + `payroll_batches.created`.
- **`payroll.export_batch`** — admin reviews the draft, clicks "Exporteer batch". This is the irreversible step. Audit: `ai.payroll.export_batch` + `payroll_batches.exported`.
- **`payroll.void_batch`** (rare) — admin clicks "Annuleer concept" with reason. Only works on `draft` batches.

---

## AI must never do

- **Export autonomously.** Even Mode 3 with confirmation requires the admin to look at the CSV preview first. This is the strictest gate in the system.
- **Mutate an `exported` row.** Any attempt should fail at the DB level; AI must never propose a "fix" that bypasses corrections.
- **Skip the checksum.** sha256 is mandatory for tamper detection.
- **Suppress the post-export notification to chefs/klanten.** Both get notified that hours are processed.
- **Combine batches.** One batch = one period = one export.
- **Re-export a `voided` batch's rows.** Voiding sets the rows back to `admin_approved` (this is the only way to un-stick); a fresh batch picks them up.
- **Touch Payingit directly.** V1 is CSV-only. AI cannot guess at API integration.

---

## Audit keys

System:

- `payroll_batches.created`
- `payroll_batches.exported` (with R2 URL + checksum + line count + total in payload)
- `payroll_batches.voided`
- `shift_hours.exported` per row

AI-assisted:

- `ai.payroll.draft_batch`
- `ai.payroll.export_batch`
- `ai.payroll.void_batch`

---

## Notifications

Per `WORKFLOW.md` Part 4.2:

| Event | In-app type | Email template (planned) |
|---|---|---|
| Batch created (draft) | `payroll_batch_ready` to admin | — |
| Batch exported | `payroll_batch_exported` to admin | — |
| (per row) export → chef notified | (in app: hours go to `exported`) | (optional small email to chef "verwerkt voor uitbetaling") |

Outbox:

- `payroll_batch.exported` → payroll provider (idempotency `payroll_batch.exported:<batchId>`).

---

## Edge cases

- **Empty batch** (no rows in window): server rejects with "geen admin_approved rijen in deze periode". AI must surface this BEFORE asking for confirm.
- **Row was `admin_approved` at draft time but got voided before export**: the export's lock+verify step catches it; export aborts. Admin re-creates batch (excluding voided row).
- **Multi-period overlap**: each `shift_hours` row appears in only ONE batch (FK uniqueness on `payroll_batch_lines.shift_hours_id`). Cannot double-export.
- **Corrections**: a correction approved after batch export becomes a NEW LINE in the NEXT batch (negative or positive delta), NEVER mutates the original row.
- **Bookkeeper role vs. owner**: V1 only `owner`+. PR-CHEF-FUT may separate.
- **R2 upload fails**: export is atomic — if CSV upload fails, the row UPDATEs are rolled back. Admin retries.
- **External payroll provider down (today: Payingit ZZP issue)**: V1 doesn't depend on live API. CSV downloads via admin UI; manual upload elsewhere. Outbox row stays for forensics.
- **Tampering check**: a future admin tool can re-checksum the file in R2 vs. stored `fileChecksum`. AI may surface "batch X file matches recorded checksum" or "MISMATCH — investigate".

---

## Example user commands

### Admin

- "Maak een payroll-batch voor mei" → AI: "Voor 1-31 mei zijn er 47 admin_approved rijen, totaal €X. 1 rate-override gedetecteerd. Wil je een conceptbatch aanmaken?" → admin clicks "Aanmaken".
- "Exporteer batch X" → AI shows CSV preview (5 first rows) + total + sha256 placeholder. Admin clicks "Exporteer". Audit fires.
- "Welke batches zijn al geëxporteerd?" → AI lists `exported` batches with date + line count + total.
- "Open de CSV van batch X" → AI returns presigned R2 URL (audit `ai.payroll.download_csv`).

### Chef/klant

- They don't interact with the batch directly. Their UI shows "Verwerkt voor uitbetaling" after export. AI may answer "wanneer wordt mijn dienst uitbetaald?" by reading the row + batch.

---

## Expected AI answer style

- **Always show totals + count + period BEFORE the confirm.**
- **Surface ANY remaining anomaly flags** on rows in the batch. If none, say so explicitly.
- **Cite the batch id post-export.**
- **Use exact language about irreversibility**: "Na exporteren kunnen rijen alleen via correcties worden gewijzigd."
- **Don't say "payment sent" — say "exported for payment".** Delivery is downstream of our system.

---

## What this workflow protects against

1. **Double-payment**: idempotency on `payroll_batch.exported` + unique `payroll_batch_lines.shift_hours_id`.
2. **Untracked changes**: append-only + corrections-only.
3. **Lost data**: R2 storage + checksum.
4. **Forgotten rows**: AI's draft step surfaces all `admin_approved` rows in window.
5. **Tampering**: sha256.

The AI's role is to make this fast WITHOUT making it sloppy. If you see the AI offering to "fix" an exported row by mutating it, that's a P0 — every fix is a `shift_hour_corrections` row.
