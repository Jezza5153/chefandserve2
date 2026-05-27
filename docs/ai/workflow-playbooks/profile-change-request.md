# Workflow: Profile change request

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.3**. Ships with PR-CHEF-4.

## Purpose

Some chef profile fields are **direct-edit** (e.g. phone, languages, availability notes). Others are **request-and-approve** (e.g. hourly rate, vakniveau, name, email). The split protects against:
- Accidental rate changes that propagate to active placements.
- Identity churn (name/email) that breaks trust + emails.
- Vakniveau inflation without verifiable basis.

A profile change request is a structured proposal from the chef. Admin reviews + approves or rejects. If approved, the change is applied AND a downstream outbox event fires (e.g. payroll sync for rate changes).

---

## Actors

- **Chef** — submits the request from `/chef/profile` (Verzoek wijziging button on locked fields).
- **Admin (`owner`+)** — reviews + approves/rejects via `/admin/business/chefs/[id]` → "Wijzigingsverzoeken" tab.
- **System** — fires email + notification + outbox event on approve.

---

## Source tables

- `chefs` — the target row to mutate on approval.
- `profile_change_requests` — the proposal record.
- `notifications`, `email_messages`, `email_events`.
- `integration_outbox` — `chef.updated` event fires on approval (future payroll rate sync).
- `audit_log`.

---

## Human status labels

`profile_change_requests.status`:

| Backend | Dutch label |
|---|---|
| `pending` | "Verzoek ingediend, wacht op admin" |
| `approved` | "Goedgekeurd" |
| `rejected` | "Afgewezen" |
| `withdrawn` | "Door chef ingetrokken" (rare; pre-approval only) |

---

## Locked vs. direct-edit field map

(Subject to refinement during PR-CHEF-4 development.)

| Field | Type | Why |
|---|---|---|
| `chefs.fullName` | Locked (request-and-approve) | Identity, used in emails/contracts |
| `chefs.email` | Locked | Login identifier |
| `chefs.vakniveau` | Locked | Drives match logic + pricing |
| `chefs.hourlyRateMinCents` / `hourlyRateMaxCents` | Locked | Pricing, propagates to Payingit |
| `chefs.phone` | Direct | Operational; chef changes their own number |
| `chefs.city` | Direct | Operational |
| `chefs.languages` | Direct | Operational |
| `chefs.segments` | Direct | Operational, can be tuned freely |
| `chefs.specialties` | Direct | Self-descriptive |
| `chefs.notes` | Read-only to chef (admin writes) | Maarten's tribal-knowledge |

For locked fields, the chef-side form replaces the input with a "Verzoek wijziging" button that opens a modal with the proposed value + reason.

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `pending` | chef (own) | locked field; proposedValue passes basic validation (e.g. rate within sane bounds); reason provided | `requestChange(field, proposedValue, reason)` |
| `pending` | `approved` | admin (`owner`+) | row is `pending`; admin clicks Approve | `approveChangeRequest(reqId, decisionNotes)` (applies the change to `chefs` table atomically) |
| `pending` | `rejected` | admin (`owner`+) | row is `pending`; admin provides decisionNotes | `rejectChangeRequest(reqId, decisionNotes)` |
| `pending` | `withdrawn` | chef (own) | chef changes their mind before approval | `withdrawChangeRequest(reqId)` |

Atomicity on approve: TWO atomic UPDATEs in one transaction.
1. `UPDATE chefs SET <field>=<proposedValue> WHERE id = chefId AND <field> = <currentValue at request time>` — guards against the field already changing.
2. `UPDATE profile_change_requests SET status='approved', decidedAt=now(), decidedBy=adminId WHERE id=reqId AND status='pending'`.

If either fails, the whole approve fails with "verzoek is niet meer actueel — vraag chef het opnieuw in te dienen".

---

## AI can read

Through `profile.read`, `profile.draft_change_request`:

- The chef's own current profile (any role).
- For chef: own pending requests.
- For admin: all pending requests, grouped by chef.
- Historical requests (approved + rejected) per chef.

The AI may answer "welke wijzigingen heb ik aangevraagd?" by reading own rows.

---

## AI can draft

- **Chef-side**: helper to formulate the reason for a request. ("Ik heb in maart mijn sous chef diploma gehaald, hierbij de bewijsstukken." — AI may help phrasing, chef attaches docs separately.)
- **Admin-side**: draft of decisionNotes. ("Vakniveau-verhoging goedgekeurd op basis van verstuurd diploma. Zie ook chef_documents #xyz.")
- **Admin-side**: explanation to chef when rejecting. ("Verzoek voor 5 euro/u verhoging — eerst even 30 dagen actief sous chef, daarna kunnen we kijken.")

---

## AI can execute only after explicit human confirmation

- **`profile.submit_change_request`** — chef clicks "Verzoek versturen" on the modal after AI helps with phrasing. Audit: `ai.profile.submit_change_request`.
- **`profile.approve_change_request`** — admin clicks "Goedkeuren" + types/accepts decisionNotes. Audit: `ai.profile.approve_change_request`.
- **`profile.reject_change_request`** — admin clicks "Afwijzen" + types decisionNotes. Audit: `ai.profile.reject_change_request`.
- **`profile.withdraw_change_request`** (chef-side) — chef clicks "Intrekken". Audit: `ai.profile.withdraw_change_request`.

---

## AI must never do

- **Auto-approve a rate change** — even with admin confirmation in chat, this requires admin to look at the proposed value + reason.
- **Apply the change without going through the request flow.** AI cannot directly mutate `chefs.hourlyRateMinCents`. The only path is via approved request.
- **Approve while pending** in a window race. Atomicity guard handles this; AI should not pretend the race doesn't matter.
- **Hide the chef's prior rejected requests** when admin reviews a new one. Show history.
- **Recommend a rate based on training data.** ("Sous chefs in Amsterdam earn €25/u" — no. Cite actual `chefs` data in the system, or stop.)
- **Propose an email change without verifying the new email**. (PR-CHEF-4 should require email-verification step on email change requests — admin's approval triggers a verification email to the NEW address before flipping `chefs.email`.)
- **Apply name change without flushing related contracts/exports.** (Out of scope today; flagged for PR-CHEF-FUT.)

---

## Audit keys

System:

- `chef.profile_change_requested`
- `chef.profile_change_approved`
- `chef.profile_change_rejected`
- `chef.profile_change_withdrawn`
- `chef.profile_updated` (when admin applies an approved change — the actual row mutation)

AI-assisted:

- `ai.profile.submit_change_request`
- `ai.profile.approve_change_request`
- `ai.profile.reject_change_request`
- `ai.profile.withdraw_change_request`

The `before`/`after` JSON in `audit_log` for `chef.profile_change_approved` MUST include the field name + old value + new value. This is the forensic record.

---

## Notifications

Per `WORKFLOW.md` Part 4.1 + 4.2:

| Event | In-app type | Email template |
|---|---|---|
| Chef submits | `profile_change_request` to admin recipients | `ProfileChangeRequestAdminEmail` |
| Admin approves | `profile_change_approved` to chef | `ProfileChangeApprovedChefEmail` |
| Admin rejects | (planned) `profile_change_rejected` to chef | (planned) `ProfileChangeRejectedChefEmail` |

Outbox:

- `chef.updated` → payroll provider (future, for rate sync). Idempotency key `chef.updated:<chefId>:<v>` where v is a monotonically incrementing version.

Routing event key: `profile_change_request`.

---

## Edge cases

- **Chef edits the same locked field while a pending request exists for it**: server rejects with "je hebt al een verzoek openstaan voor dit veld. Trek dat eerst in."
- **Admin approves while another admin rejects simultaneously**: atomicity guards both. Whoever wins, the other sees stale + retries on a now-final row.
- **Approving an email change**: PR-CHEF-4 must include the email-verification step. The approve action stages the new email + sends a verification mail to the new address; only when verified does `chefs.email` flip. Until then, status stays `approved_pending_verification` (extension to the enum).
- **Rate change while chef has confirmed placements at old rate**: existing placements use `placements.chefRateCents` if set; otherwise `shifts.chefRateCents`. The approval flow can OPTIONALLY pin existing placements to old rate via `chefRateCents` per row. PR-CHEF-4 must decide UX — default is "future shifts use new rate, existing confirmed keep old".
- **Chef tries to game by submitting multiple requests quickly**: rate-limit on `requestChange` (e.g. 5 per day).
- **Identity change for chef who has signed Q4 contracts**: out of scope; admin handles via direct DB or future legal flow.

---

## Example user commands

### Chef

- "Ik wil mijn uurtarief verhogen naar €25" → AI: "Dit is een verzoek-en-goedkeuring veld. Wil je dat ik een aanvraag voorbereid met je huidige tarief en het voorgestelde tarief? Geef ook een korte reden."
- "Mijn telefoonnummer is veranderd naar 06-..." → AI: "Telefoon kun je direct wijzigen. [Open profiel]". (No request needed.)
- "Wat is de status van mijn vakniveau-verzoek?" → AI reads own pending requests.

### Admin

- "Welke wijzigingsverzoeken liggen op mij?" → AI lists `pending` requests.
- "Approve Daniel's rate verhoging" → AI shows the proposed values, asks "ben je akkoord met €25/u? Notities?". Admin confirms; mutation fires.
- "Reject Marco's vakniveau-aanvraag, hij is nog 6 maanden commis" → AI prepares rejection with reason; admin confirms.

---

## Expected AI answer style

- For chef: explain *why* the field is locked ("Omdat je tarief op je contracten staat, en wij Payingit synchroniseren bij wijziging").
- For admin: surface the OLD value, the PROPOSED value, the REASON, and the chef's relevant history (e.g. "Daniel heeft 4× bij Lute gewerkt, gemiddelde ⭐4.7").
- Always cite the request id: "Verzoek `pcr #abc-123`."
- For sensitive fields (rate, name, email), recommend reading the history before deciding.
- Never present "auto-approve" as a UI option.
