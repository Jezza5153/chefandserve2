# Tool contracts: Shifts + placements

> Tools wrapping the proposal/accept/confirm + cancel flows. See [`../workflow-playbooks/shift-proposal-accept-confirm.md`](../workflow-playbooks/shift-proposal-accept-confirm.md) and [`../workflow-playbooks/chef-cancellation.md`](../workflow-playbooks/chef-cancellation.md).

---

## Tool: `shifts.read`

### Purpose
Read a single shift with its placements.

### Inputs
- shiftId: text

### Required role
any authed (RBAC-filtered: admin sees all; chef sees shifts they're placed on; klant sees own).

### Allowed user kinds
internal · chef · client

### Read scope
`shifts` + joined `placements`, `chefs.fullName`, `clients.companyName`.

### Write scope
None.

### Result shape
```jsonc
{
  "shift": { "id": "...", "startsAt": "...", "endsAt": "...", "roleNeeded": "sous_chef", "humanStatus": "Open", "headcount": 2, "filledCount": 1 },
  "placements": [{ "id": "...", "chef": { "id": "...", "name": "Daniel" }, "humanStatus": "Bevestigd" }]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.shifts.read`

### Rollback strategy
n/a.

---

## Tool: `shifts.find_candidates`

### Purpose
For a given shift, return ranked chef candidates.

### Inputs
- shiftId: text
- limit: int (default 8, max 20)

### Required role
owner | super_admin (future coordinator)

### Allowed user kinds
internal

### Read scope
- `chefs` (filtered: `status='active'`, soft-delete excluded, `vakniveau` matches `shift.roleNeeded` or compatible ladder)
- `chef_availability` (no blocked date for shift)
- `placements` (history: past placements at this client, ratings, no-show count)
- Phase 9+: `ai_embeddings` for semantic match on shift.notes vs. chef.notes.

### Write scope
None.

### Result shape
```jsonc
{
  "candidates": [
    {
      "chefId": "...",
      "fullName": "Daniel",
      "vakniveau": "sous_chef",
      "city": "Amsterdam",
      "matchScore": 96,
      "reasons": ["vakniveau exact", "Amsterdam (12 km)", "4× eerder bij Hotel Pulitzer", "⭐4.7 gemiddeld"],
      "availability": "ok",
      "hourlyRateRange": { "minCents": 2200, "maxCents": 2500 }
    }
  ]
}
```

### Preconditions
Shift exists; caller may view it.

### Confirmation requirement
`read`.

### Audit events
`ai.shifts.find_candidates`

### Rollback strategy
n/a.

---

## Tool: `shifts.propose_placement`

### Purpose
Create a placement in `proposed` state and email chef.

### Inputs
- shiftId: text
- chefId: text
- chefRateCents: int (optional override)
- notes: text (optional)

### Required role
owner | super_admin (future coordinator)

### Allowed user kinds
internal

### Read scope
Shift + chef + existing placements.

### Write scope
INSERT `placements` (status='proposed', proposedAt=now(), proposedBy=user.id, matchScore=?).

### Preconditions
- No existing placement for (chefId, shiftId).
- Chef status is `active`.
- Chef not blocked on shift date.
- Shift has remaining headcount (`confirmed_count < headcount`).

### Side effects
- audit `placements.proposed`
- notification `shift_proposed` to chef
- email `ShiftProposedEmail` to chef
- outbox: none (proposal is internal)

### Dry-run result shape
```jsonc
{
  "wouldInsert": { "shiftId": "...", "chefId": "...", "status": "proposed", "proposedBy": "user.id" },
  "wouldEmail": [{ "to": "chef.email", "template": "ShiftProposedEmail" }],
  "wouldNotify": [{ "userId": "chef.user.id", "type": "shift_proposed" }],
  "matchScore": 96,
  "reasons": [...]
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Verstuur voorstel".

### Audit events
- `ai.shifts.propose_placement`
- `placements.proposed`

### Rollback strategy
- Admin cancels the proposal via `setPlacementStatus('cancelled')` (separate path).
- Chef rejection (own action) moves to `rejected`.

---

## Tool: `shifts.confirm_placement`

### Purpose
Move a placement from `accepted` to `confirmed`.

### Inputs
- placementId: text

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
`UPDATE placements SET status='confirmed', confirmedAt=now() WHERE id=? AND status='accepted'`.

### Preconditions
- Placement in `accepted` status.
- Shift has remaining headcount slot.

### Side effects
- audit `placements.confirmed`
- email `ShiftConfirmedClientEmail` to klant
- (planned PR-CHEF-5) email `ShiftConfirmedChefEmail` to chef
- notification `shift_confirmed` to chef + klant
- outbox `shift.confirmed` → calendar provider

### Dry-run result shape
```jsonc
{
  "wouldConfirm": { "placementId": "...", "from": "accepted", "to": "confirmed" },
  "wouldEmail": [{ "to": "klant.email" }, { "to": "chef.email" }],
  "wouldOutbox": ["shift.confirmed:<placementId>"]
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Bevestig".

### Audit events
- `ai.shifts.confirm_placement`
- `placements.confirmed`

### Rollback strategy
`setPlacementStatus('cancelled')` if confirmed in error; both sides notified.

---

## Tool: `shifts.cancel` (admin side)

### Purpose
Admin cancels a placement (own initiative or on behalf of chef who phoned).

### Inputs
- placementId: text
- reason: text (required)
- onBehalfOfChef: boolean (default false; if true → uses `cancelled_by_admin_on_behalf` audit key)

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
`UPDATE placements SET status='cancelled', cancelledAt=now(), cancelledReason=? WHERE id=? AND status IN ('accepted','confirmed')`.

### Preconditions
- Placement in `accepted` or `confirmed`.
- Shift hasn't ended.

### Side effects
- audit `placements.cancelled` OR `placements.cancelled_by_admin_on_behalf`
- emails: `ShiftCancelledByChefClientEmail` (when on behalf) OR generic cancel emails
- notification
- outbox `placement.cancelled_by_chef` (when on behalf) or `placement.cancelled_by_admin`

### Confirmation requirement
`assisted_execute`. Admin clicks "Annuleer".

### Audit events
- `ai.shifts.cancel` or `ai.shifts.cancel_on_behalf`
- `placements.cancelled` or `placements.cancelled_by_admin_on_behalf`

### Rollback strategy
Cancellations are terminal. To re-engage chef, create a new placement.

---

## Tool: `shifts.cancel` (chef side)

### Purpose
Chef cancels their own placement; severity computed from time-to-shift.

### Inputs
- placementId: text (must be chef's own)
- reason: text (required)

### Required role
chef (own)

### Allowed user kinds
chef

### Write scope
`UPDATE placements SET status='cancelled', cancelledAt=now(), cancelledReason=? WHERE id=? AND status IN ('accepted','confirmed')` + chef ownership check.

### Preconditions
- Placement in `accepted` or `confirmed`.
- Chef owns the placement.
- Shift hasn't ended.

### Side effects
- Severity tier computed from `shift.startsAt - now()`.
- audit `placements.chef_cancelled` (with tier in payload).
- emails (T3 = urgent prefix).
- notification (T3 = priority='urgent').
- outbox `placement.cancelled_by_chef`.

### Confirmation requirement
**`draft` — AI does NOT click [Annuleer] for chef.** AI prepares form + reason text; chef clicks on their own page.

### Audit events
- `ai.shifts.draft_cancel` (AI's prep)
- `placements.chef_cancelled` (chef's actual click)

### Rollback strategy
None. Chef cannot un-cancel. Admin creates a new placement if chef changes their mind.

---

## Tool: `shifts.manual_add_hours`

### Purpose
Admin manually creates a `shift_hours` row (e.g. for a shift that bypassed normal chain because chef forgot to confirm).

### Inputs
- placementId: text
- workedMinutes: int
- breakMinutes: int
- startedAt: timestamptz (optional)
- endedAt: timestamptz (optional)
- chefRateOverrideCents: int (optional)
- reason: text (required — why this is being added manually)

### Required role
owner | super_admin

### Allowed user kinds
internal

### Write scope
INSERT `shift_hours` with `status='admin_approved'` directly (bypasses chef + klant chain).

### Preconditions
- Placement exists in `completed` state.
- No existing `shift_hours` for that placement.

### Side effects
- audit `shift_hours.admin_created (manual)` with reason.
- outbox `hours.approved` (since row enters at admin_approved).
- emails to chef + klant explaining the manual entry.

### Dry-run result shape
Shows the row that would be created + reason.

### Confirmation requirement
`assisted_execute`. Admin clicks "Maak handmatige uren-regel".

### Audit events
- `ai.shifts.manual_add_hours`
- `shift_hours.admin_created (manual)`

### Rollback strategy
Admin uses `voidHours` if mistakenly created. No correction flow needed since row is pre-export.

---

## Tool: `shifts.read_history`

### Purpose
Read placement history for a chef or client (for matching context).

### Inputs
- chefId: text (or)
- clientId: text
- since: date (optional, default last 12 months)

### Required role
owner | super_admin | coordinator (future)

### Allowed user kinds
internal

### Read scope
`placements` + joined `shifts`, `ratings` (when shipped), `shift_hours.discrepancy`.

### Write scope
None.

### Result shape
```jsonc
{
  "totalPlacements": 14,
  "byOutcome": { "completed": 12, "no_show": 0, "cancelled_by_chef": 1, "cancelled_by_admin": 1 },
  "averageRating": 4.7,
  "frequentClients": [...]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.shifts.read_history`

### Rollback strategy
n/a.
