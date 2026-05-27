# Tool contracts: Hours trust chain

> Tools wrapping the hours chain in [`../workflow-playbooks/hours-trust-chain.md`](../workflow-playbooks/hours-trust-chain.md).

---

## Tool: `hours.list_queue`

### Purpose
Surface the caller's "what's waiting on me" hours queue. Most common Mode 1 read for all roles.

### Inputs
- filter: enum `mine` | `team` | `all` (default `mine`)
- groupBy: enum `none` | `client` | `chef` | `next_actor` (default `next_actor`)
- includeAnomalyFlags: bool (default true)

### Required role
any authed (server filters by caller).

### Allowed user kinds
internal · chef · client

### Read scope
`shift_hours` joined with `placements`, `shifts`, `chefs`, `clients`. Filtered by RBAC: chef sees own; klant sees own; admin sees all.

### Write scope
None.

### Preconditions
Caller authed.

### Side effects
`ai.tool_invoked` audit row with `action='hours.list_queue'` + input params.

### Dry-run result shape
n/a (read-only).

### Result shape
```jsonc
{
  "queue": [
    {
      "shiftHoursId": "uuid",
      "humanStatus": "Wacht op klant",
      "nextActor": "klant",
      "overdueDays": 0,
      "chefName": "Daniel",
      "clientName": "Hotel Pulitzer",
      "shiftDate": "2026-06-08",
      "workedMinutes": 480,
      "expectedChefAmountCents": 12000,
      "expectedClientAmountCents": 15000,
      "anomalyFlags": []
    }
  ],
  "groupings": { "by_next_actor": { "chef": 2, "klant": 1, "admin": 5 } }
}
```

### Confirmation requirement
`read` (no confirmation).

### Audit events
`ai.hours.list_queue`

### Rollback strategy
n/a.

---

## Tool: `hours.read`

### Purpose
Read a single shift_hours row with full context.

### Inputs
- shiftHoursId: uuid

### Required role
any authed (RBAC-filtered).

### Allowed user kinds
internal · chef · client

### Read scope
Single `shift_hours` row + joined `placement`, `shift`, `chef`, `client`. RBAC enforces visibility.

### Write scope
None.

### Preconditions
Row exists; caller has visibility.

### Result shape
Full row + computed deviation + computed amount + anomaly flags + timeline (`submittedAt`, `clientSignedAt`, `adminApprovedAt`, `payingitExportedAt`).

### Confirmation requirement
`read`.

### Audit events
`ai.hours.read`

### Rollback strategy
n/a.

---

## Tool: `hours.summarize`

### Purpose
Plain-language summary of a row's status + next action.

### Inputs
- shiftHoursId: uuid
- audience: enum `chef` | `klant` | `admin` (default auto-detect from caller)

### Required role
any authed.

### Allowed user kinds
internal · chef · client

### Read scope
Same as `hours.read`.

### Write scope
None.

### Result shape
```jsonc
{
  "humanStatus": "Goedgekeurd door admin",
  "nextActor": "system",
  "nextAction": "Wordt in volgende payroll-batch geëxporteerd",
  "summary": "Je dienst van 8 juni bij Hotel Pulitzer staat op 'Goedgekeurd door admin' sinds 14 juni 09:21. ...",
  "citations": [{ "type": "shift_hours", "id": "uuid" }]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.hours.summarize`

---

## Tool: `hours.draft_reminder`

### Purpose
Generate a reminder message (chef nudge, klant nudge) that admin can send.

### Inputs
- target: enum `chef` | `klant`
- shiftHoursId: uuid (if specific row) OR clientId/chefId (if grouped)
- tone: enum `gentle` | `urgent` (default `gentle`)

### Required role
owner+ (admins only — chef and klant don't draft reminders for others).

### Allowed user kinds
internal

### Read scope
Hours queue for target.

### Write scope
None.

### Result shape
```jsonc
{
  "emailDraft": { "subject": "...", "body": "..." },
  "inAppDraft": { "title": "...", "body": "..." },
  "recipient": { "userId": "uuid", "email": "..." }
}
```

### Confirmation requirement
`draft` (this tool is draft-only; sending requires `notifications.send`).

### Audit events
`ai.hours.draft_reminder`

### Rollback strategy
n/a (no mutation).

---

## Tool: `hours.approve`

### Purpose
Move a row from `client_signed` → `admin_approved`.

### Inputs
- shiftHoursId: uuid

### Required role
owner | super_admin (future bookkeeper)

### Allowed user kinds
internal

### Read scope
Row + joined entities.

### Write scope
`UPDATE shift_hours SET status='admin_approved', adminApprovedAt=now(), adminApprovedBy=user.id WHERE id=? AND status='client_signed'`.

### Preconditions
- Row exists.
- Row status = `client_signed`.
- Caller is `owner`+.
- (Anomaly flag override: if `scheduleDeviation` or `rateOverride`, AI must confirm admin reviewed.)

### Side effects
- INSERT `audit_log` row `shift_hours.admin_approved`.
- INSERT `integration_outbox` row `hours.approved` with idempotency `hours.approved:<hoursId>`.
- `createNotification(chef.user, 'hours_approved')`.
- `sendEmail(HoursApprovedChefEmail)` + `sendEmail(HoursApprovedKlantEmail)`.

### Dry-run result shape
```jsonc
{
  "wouldApprove": { "shiftHoursId": "uuid", "from": "client_signed", "to": "admin_approved" },
  "wouldEmail": [{ "to": "chef.email", "template": "HoursApprovedChefEmail" }, { "to": "klant.email", "template": "HoursApprovedKlantEmail" }],
  "wouldOutbox": [{ "eventType": "hours.approved", "idempotencyKey": "hours.approved:uuid" }],
  "anomalyFlags": []
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Goedkeur deze rij" after seeing the dry-run.

### Audit events
- `ai.hours.approve` (the suggestion + confirm)
- `shift_hours.admin_approved` (the actual mutation)

### Rollback strategy
Use `hours.create_correction` with a negative delta. NEVER mutate the row directly.

---

## Tool: `hours.reject_by_admin`

### Purpose
Move a row from `client_signed` → `admin_rejected` with reason.

### Inputs
- shiftHoursId: uuid
- reason: text (required)

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
`UPDATE shift_hours SET status='admin_rejected', adminRejectedAt=now(), adminRejectedReason=?, adminApprovedBy=user.id WHERE id=? AND status='client_signed'`.

### Side effects
- audit `shift_hours.admin_rejected`
- notification `hours_rejected_by_admin` to chef
- email `HoursRejectedByAdminEmail` to chef + klant

### Confirmation requirement
`assisted_execute`. Admin clicks "Afwijzen met reden".

### Audit events
- `ai.hours.reject_by_admin`
- `shift_hours.admin_rejected`

### Rollback strategy
Admin uses `voidHours` (separate path) if rejected in error, then chef re-submits via new placement flow.

---

## Tool: `hours.bulk_approve`

### Purpose
Approve a curated subset of `client_signed` rows in one click.

### Inputs
- shiftHoursIds: uuid[]

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
Loops `hours.approve` per id. Not a single transaction — partial success is allowed.

### Preconditions
- Each id exists and is `client_signed`.
- AI MUST have pre-filtered to remove any row with anomaly flags BEFORE presenting to admin. Admin can add flagged rows back to the list by explicit selection.

### Side effects
Per row: same as `hours.approve` × N.

### Dry-run result shape
```jsonc
{
  "wouldApprove": [{ "shiftHoursId": "...", "chefName": "...", "amount": ... }],
  "stale": [],
  "withFlags": []
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Goedkeur N rijen".

### Audit events
- `ai.hours.bulk_approve` (one per row)
- `shift_hours.admin_approved` (one per row)

### Rollback strategy
Per row: `hours.create_correction`. Cannot undo bulk as a unit.

---

## Tool: `hours.create_correction`

### Purpose
Create a post-export correction (positive or negative delta).

### Inputs
- originalShiftHoursId: uuid
- type: enum `worked_minutes` | `chef_amount` | `client_amount`
- delta: integer (signed; minutes or cents)
- reason: text (required)

### Required role
owner | super_admin (future bookkeeper)

### Allowed user kinds
internal

### Read scope
Original row + joined entities.

### Write scope
INSERT `shift_hour_corrections` with `status='pending'`, `createdBy=user.id`.

### Preconditions
- Original row exists.
- Original row is `exported` (corrections only apply post-export).
- Caller may not approve their own correction (two-eye).

### Side effects
- audit `shift_hour_corrections.created`
- notification `correction_to_review` to OTHER admins

### Confirmation requirement
`assisted_execute`. Admin clicks "Aanmaken".

### Audit events
- `ai.hours.create_correction`
- `shift_hour_corrections.created`

### Rollback strategy
Other admin can `reject` the correction; status → `rejected`.

---

## Tool: `hours.approve_correction`

### Purpose
Approve a pending correction (must be a different admin than the creator).

### Inputs
- correctionId: uuid
- decisionNotes: text

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
`UPDATE shift_hour_corrections SET status='approved', approvedBy=user.id, approvedAt=now() WHERE id=? AND status='pending' AND createdBy != user.id`.

### Preconditions
- Correction is `pending`.
- Caller ≠ creator (two-eye).

### Side effects
- audit `shift_hour_corrections.approved`
- outbox `correction.ready` → payroll
- correction picked up by next batch

### Confirmation requirement
`assisted_execute`. Different admin clicks "Goedkeur correctie".

### Audit events
- `ai.hours.approve_correction`
- `shift_hour_corrections.approved`

### Rollback strategy
Once approved, the correction is locked. A new correction with opposite delta can reverse it.

---

## Tool: `hours.send_reminder`

### Purpose
Send a previously-drafted reminder (after admin confirms).

### Inputs
- draftId: uuid (or the drafted content + recipient inline)

### Required role
owner | super_admin (future bookkeeper for klant nudges)

### Allowed user kinds
internal

### Write scope
INSERT `email_messages`, INSERT `notifications`. Calls `sendEmail()` + `createNotification()`.

### Side effects
Email out, notification in-app, audit `ai.hours.send_reminder`. Same per-row rate-limit applies (max 1 reminder per row per 2 days).

### Confirmation requirement
`assisted_execute`. Admin clicks "Verstuur nu".

### Audit events
- `ai.hours.send_reminder`
- `notification.created`
- `email.message_recorded`

### Rollback strategy
None for sent emails. Admin may follow up with a correction or apology.

---

## Tool: `hours.submit` (chef-side)

### Purpose
Chef submits hours from draft.

### Inputs
- shiftHoursId: uuid (must be chef's own)
- startedAt: timestamptz
- endedAt: timestamptz
- breakMinutes: int
- notes: text (optional)

### Required role
chef (own)

### Allowed user kinds
chef

### Write scope
`UPDATE shift_hours SET status='submitted', submittedAt=now(), startedAt=?, endedAt=?, breakMinutes=?, notes=? WHERE id=? AND status IN ('draft', 'client_rejected')` + ownership check.

### Preconditions
- Row in `draft` or `client_rejected`.
- Chef owns the placement.
- Times are sane (start < end; total < 24h).

### Side effects
- audit `shift_hours.submit`
- outbox `hours.submitted` (internal)
- notification `hours_to_sign` to klant
- email `HoursSubmittedKlantEmail`

### Confirmation requirement
**`draft` — AI does NOT call `submitHours` on chef's behalf even with confirmation**. The chef clicks [Indien] on their own page. The AI prepares the form values via deep-link query params.

### Audit events
- `ai.hours.draft_submission` (the AI's prep)
- `shift_hours.submit` (the actual chef-click, separate audit row)

### Rollback strategy
Chef can re-submit if klant rejects.

---

## Tool: `hours.sign` (klant-side)

### Purpose
Klant signs hours.

### Inputs
- shiftHoursId: uuid

### Required role
client (own)

### Allowed user kinds
client

### Write scope
`UPDATE shift_hours SET status='client_signed', clientSignedAt=now(), clientSignedBy=user.id WHERE id=? AND status='submitted'` + ownership check.

### Preconditions
- Row in `submitted`.
- Klant owns the shift's client.

### Side effects
Same as workflow playbook.

### Confirmation requirement
**`draft` — AI does NOT click [Akkoord] for the klant.** The klant clicks on their own page. The AI's role is to show the row + open the page.

### Audit events
- `ai.hours.draft_sign` (the AI's prep)
- `shift_hours.client_signed` (the klant's actual click)

### Rollback strategy
Klant cannot un-sign. Mistakes go through admin void + chef re-submit.
