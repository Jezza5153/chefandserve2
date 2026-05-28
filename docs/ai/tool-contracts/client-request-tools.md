# Tool contracts: Client requests (submission cancel + shift change/cancel)

> Tools wrapping [`../workflow-playbooks/client-request-cancellation.md`](../workflow-playbooks/client-request-cancellation.md) and [`../workflow-playbooks/client-shift-change-request.md`](../workflow-playbooks/client-shift-change-request.md).

---

## Tool: `client_request.list`

### Purpose
List the klant's submissions and shift change/cancel requests with human status + next step.

### Inputs
- kind: enum `submissions` | `shift_changes` | `all` (default `all`)
- statusFilter: enum `open` | `all` (default `open`)

### Required role
client (own) · owner | super_admin (any)

### Allowed user kinds
internal · client

### Read scope
`client_submissions` (own) + `client_shift_change_requests` (own), via the proposed `ai_client_request_queue_view`. Surfaces `humanStatus`, `nextStep`, `canCancel`, `canRequestChange`.

### Write scope
None.

### Preconditions
Caller authed; owns the rows (session → entity).

### Side effects
`ai.tool_invoked` audit `action='client_request.list'`.

### Dry-run result shape
n/a (read-only).

### Confirmation requirement
`read`.

### Audit events
`ai.client_request.list`

### Rollback
n/a.

---

## Tool: `client_request.cancel_pending`

### Purpose
Retract a pre-conversion `client_submissions` row (assisted).

### Inputs
- submissionId: uuid (caller's own)
- reason: text (optional)

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`client_submissions` own row.

### Write scope
`UPDATE client_submissions SET status='cancelled_by_client', cancelled_by_client_at=now(), cancelled_by_client_reason=? WHERE id=? AND client_id=<own> AND status IN ('new','triaged')`.

### Preconditions
Status IN (`new`,`triaged`); caller owns it. If already `converted`, the tool refuses and routes to `shift.draft_cancel_request`.

### Side effects
- audit `client_submissions.cancelled_by_client`
- notification `client_request_cancelled` to admin recipients (reuses `client_portal_request` routing)

### Dry-run result shape
```jsonc
{ "wouldCancel": { "submissionId": "...", "from": "triaged", "to": "cancelled_by_client" }, "blockedReason": null }
```

### Confirmation requirement
`assisted_execute`. Klant clicks "Annuleren".

### Audit events
- `ai.client_request.cancel_pending`
- `client_submissions.cancelled_by_client`

### Rollback
None (terminal); klant files a fresh request.

---

## Tool: `shift.draft_change_request`

### Purpose
Prepare a change-request payload for an existing shift. Does not submit.

### Inputs
- shiftId: text (caller's own)
- what: enum `datetime` | `headcount` | `role` | `other`
- proposedChange: jsonb (e.g. `{ "startsAt": "...", "endsAt": "..." }`)
- reasonHint: text

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`shifts` + `placements` own; checks for an existing open `change` request (`client_shift_change_open_unique`).

### Write scope
None (draft only).

### Dry-run result shape
```jsonc
{ "kind": "change", "shiftId": "...", "proposedChange": { "startsAt": "..." }, "draftReason": "...", "existingOpenRequest": null }
```

### Confirmation requirement
`draft`.

### Audit events
`ai.shift.draft_change_request`

### Rollback
n/a.

---

## Tool: `shift.draft_cancel_request`

### Purpose
Prepare a cancel-request payload for an existing shift. Does not submit, and does NOT cancel.

### Inputs
- shiftId: text (caller's own)
- reasonHint: text

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`shifts` + `placements` own; checks for an existing open `cancel` request.

### Write scope
None (draft only).

### Dry-run result shape
```jsonc
{ "kind": "cancel", "shiftId": "...", "draftReason": "...", "hasConfirmedChef": true, "existingOpenRequest": null }
```

### Confirmation requirement
`draft`. (The draft must flag `hasConfirmedChef` so the AI warns that Chef & Serve will mediate.)

### Audit events
`ai.shift.draft_cancel_request`

### Rollback
n/a.

---

## Tool: `client_request.submit_shift_change` (file the drafted request)

### Purpose
File a drafted change/cancel request as a `client_shift_change_requests` row (assisted).

### Inputs
- shiftId: text · kind: enum `change` | `cancel` · reason: text (≥5 chars) · proposedChange: jsonb (change only)

### Required role
client (own)

### Allowed user kinds
client

### Write scope
INSERT `client_shift_change_requests` (`status='pending'`). Does NOT mutate `shifts`/`placements`.

### Preconditions
Caller owns the shift; no open request of the same `kind` (partial unique index). Reason ≥ 5 chars.

### Side effects
- audit `client_shift_change_requests.created`
- notification `client_shift_change_requested` to admin recipients
- email `ClientChangeRequestAdminEmail` (admin routing)

### Dry-run result shape
```jsonc
{ "wouldInsert": { "kind": "cancel", "shiftId": "...", "status": "pending" }, "duplicateBlocked": false }
```

### Confirmation requirement
`assisted_execute`. Klant clicks "Verzoek versturen" / "Annuleringsverzoek versturen".

### Audit events
- `ai.client_request.submit_shift_change`
- `client_shift_change_requests.created`

### Rollback
Admin resolves (`approved`/`rejected`); on a duplicate the tool surfaces the existing open request.

---

## Forbidden / boundaries

- **`shift.cancel_confirmed` autonomously — FORBIDDEN.** The AI never flips a confirmed `placement`/`shift` to cancelled. It may only draft a *cancel request*; an admin executes the real cancellation via the chef-facing path. (Hard rule — `ai-safety-rules.md`.)
- **No duplicate open requests** of the same kind per shift — the tool surfaces the existing one.
- **The request never mutates `shifts`/`placements`** — it is a message to Chef & Serve.
- **AI never promises an outcome** ("je shift wordt geannuleerd"); it states Chef & Serve will respond.
