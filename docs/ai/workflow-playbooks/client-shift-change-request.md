# Workflow: Client shift change / cancel request (post-conversion)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2** (klant-side). Ships with PR-KLANT-2 (`migration 0022_client_change_cancel.sql`).

## Purpose

Once a klant request has become a real `shifts` row — possibly with a proposed, accepted, or confirmed chef — the klant can no longer simply retract it. But they must never be trapped: they can always **request** a change (different date/time, headcount, role) or **request** a cancellation. The request goes to Chef & Serve, who decides; a confirmed chef's shift is never silently dropped.

The model is deliberately a *request*, not a self-service mutation: cancelling a confirmed shift has a chef on the other side and contractual/relationship consequences. Chef & Serve mediates.

---

## Actors

- **Klant** — files a change or cancel request from `/client/shifts/[shiftId]` (the hub).
- **Admin (`owner`+)** — resolves the request in `/admin/business/inbox`; marks `in_progress` → `approved`/`rejected` with decision notes.
- **System** — emails the admin routable group on file; emails the klant the outcome on decision.

---

## Source tables

- `client_shift_change_requests` — the request record: `shift_id`, `client_id`, `requested_by`, `kind` enum (`change`/`cancel`), `reason` (required), `proposed_change jsonb` (e.g. `{ "startsAt": "...", "endsAt": "..." }`), `status` enum (`pending`/`in_progress`/`approved`/`rejected`), `decided_by`, `decision_notes`.
- `shifts` / `placements` — context; the request does NOT mutate these directly.
- `notifications`, `email_messages`, `email_events`.
- `audit_log`.

**Constraint:** a partial unique index `client_shift_change_open_unique ON (shift_id, kind) WHERE status IN ('pending','in_progress')` enforces **one open request per shift per kind**.

---

## Human status labels

`client_shift_change_requests.status`:

| Backend | Dutch label |
|---|---|
| `pending` | "Verzoek ontvangen" |
| `in_progress` | "In behandeling" |
| `approved` | "Doorgevoerd" |
| `rejected` | "Niet doorgevoerd" |

The hub renders an open request inline (label + filed-at) so the klant sees their request is being handled.

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `pending` | klant (own) | shift belongs to caller's client; no open request of same `kind` for this shift; reason ≥ 5 chars | `requestShiftChange(shiftId, kind, reason, proposedChange)` |
| `pending` | `in_progress` | admin (`owner`+) | admin picks it up | admin action |
| `pending`/`in_progress` | `approved` | admin (`owner`+) | admin executes the underlying change/cancel via the proper shift/placement action, then marks the request | admin action + decision notes |
| `pending`/`in_progress` | `rejected` | admin (`owner`+) | decision notes provided | admin action |

The request row never mutates `shifts` or `placements` itself. When an admin **approves a cancel request**, they perform the real cancellation through the existing shift/placement cancellation action (which has its own atomic guard + audit + chef notification) — the request row is then marked `approved`. This keeps the chef-facing cancellation on its proper, audited path.

---

## AI can read

Through `client_request.list` + the proposed `ai_client_request_queue_view`:

- The klant's own open + historical change/cancel requests for their shifts (`humanStatus`, `nextStep`, `canRequestChange`).
- Whether an open request already exists for a given (shift, kind) — so the AI doesn't offer a duplicate.
- For admin: the queue of pending/in-progress requests.

Cites `client_shift_change_requests.id`.

---

## AI can draft

- The `reason` text for a change or cancel request.
- A structured `proposed_change` payload for a change request (e.g. new start/end time, new headcount, new role).
- For admin: draft `decision_notes`.

---

## AI can execute only after explicit human confirmation

- **`shift.draft_change_request`** / **`shift.draft_cancel_request`** are draft-only (see [`../tool-contracts/client-request-tools.md`](../tool-contracts/client-request-tools.md)).
- **Filing the request** — klant clicks "Verzoek versturen" / "Annuleringsverzoek versturen" after the AI drafts. Audit: `ai.client_request.submit_shift_change`.

The act of filing is the klant's click; the AI prepares the modal contents.

---

## AI must never do

- **Cancel a confirmed shift autonomously.** This is a hard rule (`ai-safety-rules.md`). The AI may draft a *cancel request*; an admin executes the actual cancellation via the chef-facing path. The AI never flips a `placement` to `cancelled`.
- **File a duplicate open request** of the same kind for a shift. It surfaces the existing one instead.
- **Mutate `shifts`/`placements` directly** from this flow. The request is a message to Chef & Serve, not a state change.
- **Promise an outcome.** "Je shift wordt geannuleerd" is wrong; "Chef & Serve neemt direct contact op" is right.
- **Skip the reason.** A change/cancel request requires a reason (≥ 5 chars).

---

## Audit keys

System:

- `client_shift_change_requests.created`
- `client_shift_change_requests.in_progress`
- `client_shift_change_requests.approved`
- `client_shift_change_requests.rejected`
- (the actual cancellation, when an admin approves a cancel request, audits separately under the existing `placements.cancelled*` / shift-cancellation key)

AI-assisted:

- `ai.client_request.submit_shift_change` (paired with `client_shift_change_requests.created`)

---

## Notifications

Reusing the `client_portal_request` / `client_shift_change_requested` routing event:

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Klant files change/cancel request | `client_shift_change_requested` to admin recipients | `ClientChangeRequestAdminEmail` | admin routing |
| Admin decides | `client_shift_change_decided` to klant | `ClientChangeRequestOutcomeKlantEmail` | `recipientsForClient(clientId, 'client_shift_change_requested')` |
| (on approved cancel) chef notified | `shift_cancelled_*` to chef | the existing chef-cancellation email | chef routing |

---

## Edge cases

- **Duplicate request**: the unique index (or a pre-check) blocks a second open request of the same kind. Modal shows "Je hebt al een wijzigingsverzoek openstaan voor deze shift." The hub then shows the existing open request inline. AI surfaces it, never offers to refile.
- **Change request on an already-cancelled shift**: `allowedActions` won't include `change_request`; AI redirects to filing a fresh request (global action).
- **Cancel request on a confirmed shift with a chef**: allowed to *request*; admin must contact the chef and execute the cancellation properly. AI emphasises Chef & Serve will reach out.
- **Klant files change, then wants to cancel instead**: `change` and `cancel` are different kinds, so both can be open simultaneously (the unique index is per-kind). AI clarifies which kind to file.
- **`proposed_change` malformed**: server validates the jsonb shape; AI drafts a well-formed payload (start/end ISO timestamps, integer headcount).

---

## Example user commands

### Klant (own)

- "Kan de vrijdag-shift een uur later beginnen?" → AI drafts a `change` request with `proposed_change={startsAt: ...}` + reason, asks the klant to click "Verzoek versturen".
- "Ik moet de shift van zaterdag annuleren." → AI drafts a `cancel` request with reason, warns that Chef & Serve will contact them (a chef may be confirmed), asks for the click.
- "Heb ik al een wijziging aangevraagd voor deze shift?" → AI checks for an open request and reports its status.

### Admin

- "Welke wijzigings-/annuleringsverzoeken liggen open?" → AI lists `pending`/`in_progress`, oldest first.

---

## Expected AI answer style

- **Frame as a request**, never a guaranteed outcome.
- **Require + draft a reason**; for changes, a concrete `proposed_change`.
- **Surface an existing open request** rather than duplicating.
- **Cite**: "Bron: verzoek `csc #abc-123`, status 'In behandeling'."
- **For confirmed shifts**, explicitly note a chef is involved and Chef & Serve mediates.
