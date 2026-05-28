# Tool contracts: Client profile + comments

> Tools wrapping the klant profile + shift-hub + comment workflows in [`../workflow-playbooks/client-profile-change.md`](../workflow-playbooks/client-profile-change.md), [`../workflow-playbooks/client-shift-hub.md`](../workflow-playbooks/client-shift-hub.md), and [`../workflow-playbooks/chef-preview-comment.md`](../workflow-playbooks/chef-preview-comment.md).

---

## Tool: `client.read`

### Purpose
Read the klant's own profile, shift-hub summary, and klant-visible context, RBAC-filtered.

### Inputs
- section: enum `profile` | `shift` | `requests` (default `profile`)
- shiftId: text (when `section='shift'`)

### Required role
client (own) · owner | super_admin (any)

### Allowed user kinds
internal · client

### Read scope
`clients` (own row), `shifts` + `placements` (own shifts), `placement_comments` via `listVisibleComments(placementId, {kind:'client'})` → `client_visible` only, the proposed `ai_client_shift_summary_view`. Chef fields limited to `clientVisible`. NEVER reads `placements.notes`.

### Write scope
None.

### Preconditions
Caller authed; owns the entity (session → entity, never trust a form id).

### Side effects
`ai.tool_invoked` audit with `action='client.read'`.

### Dry-run result shape
n/a (read-only).

### Confirmation requirement
`read`.

### Audit events
`ai.client.read`

### Rollback
n/a.

---

## Tool: `client.draft_profile_change`

### Purpose
Prepare a request-change payload for a protected field. Does not submit.

### Inputs
- field: enum `companyName` | `kvk` | `btw` | `email` | `paymentTermsDays` | `billingAddress`
- proposedValue: text/int (typed per field)
- reasonHint: text (optional)

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`clients` own row (for `currentValue`).

### Write scope
None (draft only).

### Preconditions
Field is a request-change field; no existing `pending` `client_change_requests` row for the same field.

### Side effects
None.

### Dry-run result shape
```jsonc
{ "field": "paymentTermsDays", "currentValue": 14, "proposedValue": 60, "draftReason": "...", "draftId": "uuid" }
```

### Confirmation requirement
`draft`.

### Audit events
`ai.client.draft_profile_change`

### Rollback
n/a (no mutation).

---

## Tool: `client.submit_profile_change`

### Purpose
Submit a drafted request-change for a protected field (assisted).

### Inputs
- draftId: uuid OR inline `field` + `proposedValue` + `reason`

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`clients` own row.

### Write scope
INSERT `client_change_requests` (`status='pending'`, `client_id=<own>`).

### Preconditions
Protected field; no existing `pending` for the same field; value validates.

### Side effects
- audit `client.change_requested`
- notification `client_change_request` to admin recipients
- email `ClientChangeRequestAdminEmail` (admin routing)

### Dry-run result shape
```jsonc
{ "wouldInsert": { "field": "paymentTermsDays", "proposedValue": 60, "status": "pending" }, "wouldEmail": [{ "to": "<admin recipients>", "template": "ClientChangeRequestAdminEmail" }] }
```

### Confirmation requirement
`assisted_execute`. Klant clicks "Verzoek versturen".

### Audit events
- `ai.client.submit_profile_change`
- `client.change_requested`

### Rollback
Admin can reject; klant submits a fresh request.

---

## Tool: `client.update_direct_field`

### Purpose
Update a non-protected klant field directly (assisted).

### Inputs
- field: enum `contactName` | `phone` | `billingEmail` | `shiftAddress` | `shiftArrivalNotes` | `city`
- newValue: text

### Required role
client (own) · owner | super_admin (any)

### Allowed user kinds
internal · client

### Read scope
`clients` own row.

### Write scope
`UPDATE clients SET <field>=?, updatedAt=now() WHERE id=? AND <ownership>`.

### Preconditions
Field in the direct-edit allowlist; value validates.

### Side effects
- audit `client.profile_updated`
- outbox `client.updated`
- on `billingEmail` change: email `BillingEmailChangedKlantEmail` to the **OLD** address (7-day rollback notice)

### Dry-run result shape
```jsonc
{ "wouldUpdate": { "field": "phone", "from": "...", "to": "..." }, "wouldEmailOldAddress": false }
```

### Confirmation requirement
`assisted_execute`. Klant clicks "Opslaan". (Direct edits still confirm to avoid save-surprise; `billingEmail` confirmation must mention the old-address safeguard.)

### Audit events
- `ai.client.update_direct_field`
- `client.profile_updated`

### Rollback
Another direct update; for `billingEmail`, the 7-day OLD-address rollback path.

---

## Tool: `client.add_comment`

### Purpose
Post a klant comment on a proposed chef into `placement_comments` (assisted).

### Inputs
- placementId: text (must be on caller's own shift)
- body: text (1–1000 chars)

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`placements` + `shifts` for ownership.

### Write scope
`addPlacementComment({ placementId, authorUserId, authorKind:'client', visibility:'client_visible', body })`. The tool FORCES `author_kind='client'` + `visibility='client_visible'` — the AI cannot widen visibility.

### Preconditions
Placement on caller's shift; body trims to 1–1000 chars.

### Side effects
- audit `placement_comments.created`
- notification to admin recipients

### Dry-run result shape
```jsonc
{ "wouldInsert": { "placementId": "...", "authorKind": "client", "visibility": "client_visible", "body": "..." } }
```

### Confirmation requirement
`assisted_execute`. Klant clicks "Stuur opmerking".

### Audit events
- `ai.client.add_comment`
- `placement_comments.created`

### Rollback
None (comments are append-only); admin can post a follow-up.

---

## Forbidden / boundaries

- **`client.approve_change` — DOES NOT EXIST for the klant.** Approving a change request is admin-only; the AI may never approve a klant's own request.
- **`client.set_payment_term` directly — FORBIDDEN.** `paymentTermsDays` is request-change only.
- **AI never reads `placements.notes`** for klant answers — use `listVisibleComments` (`client_visible`) or `ai_client_shift_summary_view`.
- **AI never widens a comment's visibility** beyond `client_visible` for klant callers.
- **AI never sends hours-signing or chef-approval on the klant's behalf** — those live in other surfaces and require the klant's own click.
