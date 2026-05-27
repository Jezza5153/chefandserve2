# Tool contracts: Profiles + change requests

> Tools wrapping profile read + change-request workflows. See [`../workflow-playbooks/profile-change-request.md`](../workflow-playbooks/profile-change-request.md).

---

## Tool: `profile.read`

### Purpose
Read a chef's or klant's profile, filtered by caller's RBAC.

### Inputs
- entityType: enum `chef` | `client`
- entityId: text

### Required role
any authed (RBAC-filtered).

### Allowed user kinds
internal · chef · client

### Read scope
- `chefs` or `clients` row.
- For caller's own profile: all non-encrypted fields.
- For another chef (admin only): all non-encrypted fields.
- For another chef (klant context): only `fullName`, `vakniveau`, `city`, `languages` AND only if there's an active placement bridging caller's client to that chef.
- For another klant (chef context): only `companyName`, `city`, `segment` (with active placement bridge).

### Write scope
None.

### Result shape
```jsonc
{
  "entityType": "chef",
  "entityId": "...",
  "fields": {
    "fullName": "Daniel",
    "vakniveau": "sous_chef",
    "city": "Amsterdam",
    "languages": ["nl", "en"],
    "segments": ["fine_dining", "hotel"],
    "specialties": "...",
    // status etc. visible per role
  },
  "lockedFields": ["fullName", "email", "vakniveau", "hourlyRateMinCents", "hourlyRateMaxCents"]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.profile.read`

---

## Tool: `profile.list_change_requests`

### Purpose
List pending / historical change requests.

### Inputs
- entityId: text (optional; default own)
- statusFilter: enum `pending` | `approved` | `rejected` | `all` (default `pending`)
- limit: int (default 20)

### Required role
chef (own) · owner | super_admin (any) · client (own — though klant change requests are out of V1 scope, the surface exists)

### Allowed user kinds
internal · chef · client

### Read scope
`profile_change_requests` filtered.

### Write scope
None.

### Result shape
```jsonc
{
  "requests": [
    { "id": "...", "field": "hourlyRateMinCents", "currentValue": 2200, "proposedValue": 2500, "reason": "...", "status": "pending", "createdAt": "..." }
  ]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.profile.list_change_requests`

---

## Tool: `profile.draft_change_request`

### Purpose
Prepare a change-request payload for the user. Does not submit.

### Inputs
- field: text (must be a locked field per workflow playbook)
- proposedValue: text/int (typed per field)
- reasonHint: text (optional — user's free-text input)

### Required role
chef (own) · client (own)

### Allowed user kinds
chef · client

### Read scope
Caller's own profile + any related entities (e.g. hourly rate context: recent placements).

### Write scope
None (draft only).

### Result shape
```jsonc
{
  "field": "hourlyRateMinCents",
  "currentValue": 2200,
  "proposedValue": 2500,
  "draftReason": "Ik werk inmiddels 6 maanden als sous chef en heb 4 keer bij Hotel Pulitzer goed gepresteerd...",
  "estimatedApprovalTime": "binnen 5 werkdagen typically",
  "draftId": "uuid"  // ephemeral
}
```

### Confirmation requirement
`draft` only.

### Audit events
`ai.profile.draft_change_request`

---

## Tool: `profile.submit_change_request`

### Purpose
Submit a drafted change request.

### Inputs
- draftId: uuid (from draft) OR inline:
- field: text
- proposedValue: any (typed)
- reason: text

### Required role
chef (own) · client (own)

### Allowed user kinds
chef · client

### Read scope
Own profile.

### Write scope
INSERT `profile_change_requests` (status='pending', requestedBy=user.id).

### Preconditions
- No existing pending request for same (entityId, field).
- Proposed value passes basic validation.
- Rate limit: max 5 requests per day per user.

### Side effects
- audit `chef.profile_change_requested` or `client.profile_change_requested`.
- notification `profile_change_request` to admin recipients.
- email `ProfileChangeRequestAdminEmail`.

### Dry-run result shape
```jsonc
{
  "wouldInsert": { "field": "...", "proposedValue": "...", "status": "pending" },
  "wouldNotify": [{ "userIds": [admin.user.ids], "type": "profile_change_request" }],
  "wouldEmail": [{ "to": "<admin recipients>", "template": "ProfileChangeRequestAdminEmail" }]
}
```

### Confirmation requirement
`assisted_execute`. User clicks "Verzoek versturen" with explicit destination preview.

### Audit events
- `ai.profile.submit_change_request`
- `chef.profile_change_requested` (or `client.profile_change_requested`)

### Rollback strategy
User can withdraw via `profile.withdraw_change_request` while still `pending`.

---

## Tool: `profile.approve_change_request`

### Purpose
Admin approves a pending change request; the change applies to the master row.

### Inputs
- requestId: uuid
- decisionNotes: text

### Required role
owner | super_admin

### Allowed user kinds
internal

### Read scope
Request + target entity.

### Write scope
- Atomic 2-UPDATE transaction:
  1. `UPDATE <chefs|clients> SET <field>=<proposedValue> WHERE id=? AND <field>=<currentValue at request time>`.
  2. `UPDATE profile_change_requests SET status='approved', decidedAt=now(), decidedBy=user.id, decisionNotes=? WHERE id=? AND status='pending'`.

### Preconditions
- Request is `pending`.
- Current value of field matches what was at request time (no concurrent change).

### Side effects
- audit `chef.profile_change_approved` / `chef.profile_updated` (paired) — `before`/`after` includes the field name + values.
- outbox `chef.updated` → payroll (for rate changes).
- notification `profile_change_approved` to chef.
- email `ProfileChangeApprovedChefEmail`.

### Dry-run result shape
```jsonc
{
  "wouldApply": { "entityType": "chef", "entityId": "...", "field": "hourlyRateMinCents", "from": 2200, "to": 2500 },
  "wouldFireOutbox": ["chef.updated:<chefId>:<v+1>"],
  "wouldNotify": [...],
  "wouldEmail": [...]
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Goedkeur en pas toe".

### Audit events
- `ai.profile.approve_change_request`
- `chef.profile_change_approved`
- `chef.profile_updated`

### Rollback strategy
Create a new change request to reverse, OR admin manually edits + writes audit "profile.manual_correction". The original audit row is preserved.

---

## Tool: `profile.reject_change_request`

### Purpose
Admin rejects a pending change request with reason.

### Inputs
- requestId: uuid
- decisionNotes: text (required)

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
`UPDATE profile_change_requests SET status='rejected', decidedAt=now(), decidedBy=user.id, decisionNotes=? WHERE id=? AND status='pending'`.

### Side effects
- audit `chef.profile_change_rejected` (with decisionNotes in payload).
- (planned) notification `profile_change_rejected` to chef.
- (planned) email `ProfileChangeRejectedChefEmail`.

### Confirmation requirement
`assisted_execute`. Admin clicks "Afwijzen met reden".

### Audit events
- `ai.profile.reject_change_request`
- `chef.profile_change_rejected`

### Rollback strategy
None on the request; user may submit a fresh request.

---

## Tool: `profile.withdraw_change_request`

### Purpose
User withdraws own pending request.

### Inputs
- requestId: uuid

### Required role
chef (own) · client (own)

### Allowed user kinds
chef · client

### Write scope
`UPDATE profile_change_requests SET status='withdrawn', withdrawnAt=now() WHERE id=? AND requestedBy=user.id AND status='pending'`.

### Side effects
- audit `chef.profile_change_withdrawn`.

### Confirmation requirement
`assisted_execute`. User clicks "Trek verzoek in".

### Audit events
- `ai.profile.withdraw_change_request`
- `chef.profile_change_withdrawn`

### Rollback strategy
User submits a new request.

---

## Tool: `profile.update_direct_field`

### Purpose
Update a non-locked field directly (e.g. phone, languages).

### Inputs
- entityType: enum `chef` | `client`
- entityId: text (must match caller)
- field: text (must be in direct-edit allowlist)
- newValue: any (typed)

### Required role
chef (own) · client (own) · owner | super_admin (any)

### Allowed user kinds
internal · chef · client

### Write scope
`UPDATE <chefs|clients> SET <field>=<newValue>, updatedAt=now() WHERE id=? AND <ownership>`.

### Preconditions
- Field is in the direct-edit allowlist (see `profile-change-request.md` field map).
- Value passes validation.

### Side effects
- audit `chef.profile_updated` / `client.profile_updated`.
- No outbox (direct fields don't sync externally in V1).

### Dry-run result shape
```jsonc
{
  "wouldUpdate": { "entityId": "...", "field": "phone", "from": "06-...", "to": "06-..." }
}
```

### Confirmation requirement
`assisted_execute`. User clicks "Opslaan" — even direct edits go through confirmation in chat (to avoid "save" surprise).

### Audit events
- `ai.profile.update_direct_field`
- `chef.profile_updated`

### Rollback strategy
Revert via another direct update.

---

## Boundaries

- **AI never modifies `chefs.notes` (Maarten's tribal-knowledge field).** Read-only for AI. Admin writes via UI.
- **No AI flow modifies `userId` linkage.** Portal access changes go through `auth.invite_*` (separate surface, not in this file).
- **AI never modifies `payingitEmployeeId` / `payingitClientId`.** Set during onboarding by admin; never via AI.
- **Rate-change approvals must surface placement impact.** AI must mention "X confirmed placements use this rate" before confirming.
- **Identity changes (`fullName`, `email`)** require additional verification step beyond approval. PR-CHEF-4 may include email-verification flow; AI surfaces this.
