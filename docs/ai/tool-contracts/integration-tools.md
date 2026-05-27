# Tool contracts: Integrations + payroll

> Tools for the outbox, integration health monitoring, payroll batches, and R2 access. See [`../workflow-playbooks/payroll-export.md`](../workflow-playbooks/payroll-export.md) for the payroll workflow.

---

## Tool: `integrations.health`

### Purpose
Surface integration health — outbox queue depth, recent failures, provider status.

### Inputs
- provider: enum `payroll` | `accounting` | `calendar` | `email` | `all` (default `all`)
- window: enum `1h` | `24h` | `7d` (default `24h`)

### Required role
owner | super_admin (future bookkeeper for finance providers)

### Allowed user kinds
internal

### Read scope
- `integration_outbox` (counts by status).
- `integration_runs` (recent successful + failed runs).
- `email_events` (delivery rates).

### Write scope
None.

### Result shape
```jsonc
{
  "providers": [
    {
      "provider": "payroll",
      "status": "ok",
      "queueDepth": 3,
      "failedLast24h": 0,
      "lastSuccessAt": "2026-05-27T10:14:00Z",
      "nextAction": null
    },
    {
      "provider": "calendar",
      "status": "degraded",
      "queueDepth": 12,
      "failedLast24h": 4,
      "lastSuccessAt": "2026-05-26T14:00:00Z",
      "nextAction": "Retry oldest 4 failed outbox rows, or contact provider"
    }
  ]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.integrations.health`

---

## Tool: `integrations.retry_outbox`

### Purpose
Re-enqueue a specific failed outbox row for retry.

### Inputs
- outboxId: uuid

### Required role
owner | super_admin

### Allowed user kinds
internal

### Read scope
`integration_outbox` row.

### Write scope
`UPDATE integration_outbox SET status='pending', nextAttemptAt=now(), retryCount=retryCount+1 WHERE id=? AND status='failed'`.

### Preconditions
- Row is `failed`.
- `retryCount < maxRetries` (e.g. 10).
- Idempotency key still valid (the underlying event hasn't been re-fired with a different payload).

### Side effects
- audit `integration.outbox_retried`.
- Worker picks up on next poll.

### Dry-run result shape
```jsonc
{
  "wouldRetry": { "outboxId": "...", "eventType": "...", "previousAttempts": 3 }
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Probeer opnieuw".

### Audit events
- `ai.integrations.retry_outbox`
- `integration.outbox_retried`

### Rollback strategy
None — retries are idempotent by design.

---

## Tool: `integrations.read_outbox_row`

### Purpose
Inspect a single outbox row + its history.

### Inputs
- outboxId: uuid

### Required role
owner | super_admin

### Read scope
`integration_outbox` + joined `integration_runs` (every attempt).

### Write scope
None.

### Result shape
Full row + retry log + error messages.

### Confirmation requirement
`read`.

### Audit events
`ai.integrations.read_outbox_row`

---

## Tool: `payroll.draft_batch`

### Purpose
Build a draft payroll batch for a period; show preview before export.

### Inputs
- periodStart: date
- periodEnd: date

### Required role
owner | super_admin (future bookkeeper)

### Allowed user kinds
internal

### Read scope
`shift_hours` where `status='admin_approved'` AND `shift.endsAt` between (start, end). Plus `shift_hour_corrections` approved in window.

### Write scope
INSERT `payroll_batches` (status='draft') + INSERT `payroll_batch_lines` (one per row).

### Preconditions
- Window is valid (start < end, both in past).
- At least one `admin_approved` row in window.
- No existing draft batch overlapping window (must void or export first).

### Side effects
- audit `payroll_batches.created`.
- notification `payroll_batch_ready` to admin.

### Dry-run result shape
```jsonc
{
  "wouldCreateBatch": { "periodStart": "...", "periodEnd": "...", "lineCount": 47, "totalCents": 1234567 },
  "lines": [{ "shiftHoursId": "...", "chefName": "...", "amount": ... }],
  "anomalies": [
    { "type": "rate_override", "shiftHoursId": "..." }
  ]
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Maak conceptbatch".

### Audit events
- `ai.payroll.draft_batch`
- `payroll_batches.created`

### Rollback strategy
`payroll.void_batch` on the draft.

---

## Tool: `payroll.export_batch`

### Purpose
Export a draft batch — generates CSV, uploads to R2, transitions rows to `exported`. **The irreversible step.**

### Inputs
- batchId: uuid

### Required role
owner | super_admin

### Allowed user kinds
internal

### Read scope
Batch + lines + joined entities.

### Write scope
Single atomic transaction:
1. SELECT FOR UPDATE all `shift_hours` rows in batch.
2. Verify all still `admin_approved`.
3. UPDATE each row to `status='exported'`, `payingitExportedAt=now()`.
4. UPDATE batch to `status='exported'`, `fileUrl=?`, `fileChecksum=?`, `exportedAt=now()`, `exportedBy=user.id`.
5. INSERT outbox `payroll_batch.exported` with idempotency `payroll_batch.exported:<batchId>`.

R2 write: upload CSV to `payroll/<year>/<batchId>.csv` (before the DB transaction commits). Compute sha256.

### Preconditions
- Batch is `draft`.
- All linked rows are still `admin_approved` (else: abort with stale-row error).
- R2 connection healthy.

### Side effects
- audit `payroll_batches.exported` (with R2 URL + checksum in payload).
- audit `shift_hours.exported` per row.
- outbox `payroll_batch.exported`.
- (optional) email chef "verwerkt voor uitbetaling".

### Dry-run result shape
```jsonc
{
  "wouldExport": { "batchId": "...", "lineCount": 47, "totalCents": 1234567 },
  "wouldWriteToR2": "payroll/2026/<batchId>.csv",
  "wouldComputeChecksum": "sha256",
  "wouldFireOutbox": "payroll_batch.exported:<batchId>",
  "anomaliesRemaining": []
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Exporteer batch" with explicit "let op: dit is onomkeerbaar" warning + checksum display.

### Audit events
- `ai.payroll.export_batch`
- `payroll_batches.exported`
- `shift_hours.exported` (per row)

### Rollback strategy
None at the row level. Use `hours.create_correction` for any post-export adjustments.

---

## Tool: `payroll.void_batch`

### Purpose
Void a draft batch (rare; e.g. period was wrong).

### Inputs
- batchId: uuid
- reason: text

### Required role
owner | super_admin

### Write scope
`UPDATE payroll_batches SET status='voided', voidedAt=now(), voidedReason=? WHERE id=? AND status='draft'`. Lines stay (audit), but rows go back to `admin_approved` (still picked up by next draft).

### Preconditions
Batch is `draft` (cannot void `exported`).

### Side effects
- audit `payroll_batches.voided`.

### Confirmation requirement
`assisted_execute`. Admin clicks "Annuleer concept" with reason.

### Audit events
- `ai.payroll.void_batch`
- `payroll_batches.voided`

### Rollback strategy
Create a new draft batch.

---

## Tool: `payroll.read_batch`

### Purpose
Inspect a batch (draft, exported, or voided).

### Inputs
- batchId: uuid

### Required role
owner | super_admin

### Read scope
Batch + lines + checksum.

### Write scope
None.

### Result shape
Full batch + lines (anonymisable for non-finance admins per future bookkeeper split).

### Confirmation requirement
`read`.

### Audit events
`ai.payroll.read_batch`

---

## Tool: `payroll.download_csv`

### Purpose
Generate a fresh presigned R2 URL for the CSV.

### Inputs
- batchId: uuid

### Required role
owner | super_admin

### Read scope
Batch (`fileUrl`).

### Write scope
None (URL generation is read-only at our DB layer).

### Result shape
```jsonc
{
  "presignedUrl": "https://...",
  "expiresAt": "<5 minutes from now>",
  "checksum": "sha256:..."
}
```

### Side effects
- audit `ai.payroll.download_csv` (so we know who pulled the file when).

### Confirmation requirement
`assisted_execute`. Admin clicks "Download CSV".

### Audit events
- `ai.payroll.download_csv`

---

## Tool: `documents.read_metadata`

### Purpose
List chef documents (metadata only).

### Inputs
- chefId: text

### Required role
- owner | super_admin (any chef)
- chef (own)
- client (only `clientVisible=true` AND `status='verified'` documents of chefs placed at their active shifts)

### Read scope
`chef_documents` rows, RBAC-filtered.

### Write scope
None.

### Result shape
```jsonc
{
  "documents": [
    { "id": "...", "type": "cv", "filename": "...", "uploadedAt": "...", "status": "verified", "clientVisible": false, "expiresAt": "..." }
  ]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.documents.read_metadata`

---

## Tool: `documents.read_bytes`

### Purpose
Get a presigned URL for a document's bytes.

### Inputs
- documentId: text

### Required role
- owner | super_admin (any)
- chef (own)
- client (only clientVisible + verified, with active placement bridge)

### Read scope
`chef_documents` row + R2 presign.

### Write scope
None at DB layer.

### Result shape
```jsonc
{
  "presignedUrl": "https://...",
  "expiresAt": "<5 minutes from now>",
  "filename": "...",
  "mimeType": "..."
}
```

### Side effects
- audit `ai.documents.read_bytes` (high-attention — admin can review who downloaded what).

### Confirmation requirement
`assisted_execute`. Caller clicks "Download document" with destination preview ("<filename>").

### Audit events
- `ai.documents.read_bytes`

### Rollback strategy
None — presigned URLs expire quickly. Cannot "unsend" a download.

---

## Boundaries

- **AI never decrypts payroll-related secrets**, age-encrypted backups, or TOTP secrets.
- **AI never directly hits Payingit API.** All payroll-related external communication is via outbox + worker.
- **AI never edits `external_refs` rows.** Those are written by adapters only.
- **AI never modifies the R2 contents.** Read-only via presigned URL.
- **`payroll.export_batch` requires the strongest confirmation copy** — explicit irreversibility warning, exact period, exact totals.
