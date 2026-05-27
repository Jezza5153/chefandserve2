# Workflow: Admin bulk hours approval (sub-flow of hours trust chain)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.1** — admin approval stage. Ships with PR-CHEF-3.

## Purpose

Maarten faces a queue of dozens of `client_signed` rows. Reviewing each one in detail is slow. Bulk approval lets him approve a *selected subset* in one go, while still requiring per-row review of anomaly-flagged rows.

The mechanism: a checkbox-list UI at `/admin/business/hours` where Maarten ticks the rows he wants to approve. Clean rows get bulk-approve; flagged rows force per-row review.

**Critically: this is NOT "approve all".** The AI never expands selection without explicit admin curation.

---

## Actors

- **Admin (`owner`+, future `bookkeeper`)** — reviews the queue, selects, approves.
- **System** — performs per-row atomic updates, fires per-row audit + outbox.
- **AI** — drafts the safe subset, surfaces flags, never auto-selects flagged rows.

---

## Source tables

- `shift_hours` (status `client_signed` → `admin_approved`).
- `placements`, `shifts`, `chefs`, `clients` — context for the queue.
- `audit_log`, `integration_outbox`, `notifications`, `email_messages`.

---

## Human status labels

Same as [`hours-trust-chain.md`](./hours-trust-chain.md). Queue UI shows:

- Chef name
- Client + shift date
- Worked time + scheduled time
- Anomaly flags (badges): `Afwijking schema`, `Rate overrule`, `Late inzending`, `Eerder afgewezen`
- Computed amount

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| `client_signed` | `admin_approved` | admin (`owner`+) | row is `client_signed`; admin reviewed (no enforcement, but anomaly flags act as soft gates) | server action `approveHours` per row |
| `client_signed` | `admin_rejected` | admin (`owner`+) | reason required | `rejectHours` (admin side) per row |
| (multi) | (multi `admin_approved`) | admin (`owner`+) | each row selected individually | `bulkApproveHours(ids[])` |

**`bulkApproveHours` implementation note**: NOT a single transaction. Loops over `approveHours` per id. Some succeeding + some failing is acceptable; the response reports per-row outcome. This is intentional — atomicity at the bulk level would mean a single bad row blocks the rest.

---

## Anomaly flags (computed at queue load)

Per row, set boolean flags:

| Flag | Logic | UI treatment |
|---|---|---|
| `scheduleDeviation` | `|workedMinutes - scheduledMinutes| > 15` | Yellow badge |
| `rateOverride` | `placement.chefRateCents != shift.chefRateCents` (and not null) | Yellow badge |
| `lateSubmission` | `submittedAt > shiftEndsAt + 7 days` | Orange badge |
| `previouslyRejected` | row was `client_rejected` then resubmitted | Orange badge |
| `chefHistoryConcern` | chef has 3+ no-shows in last 90d (read-only signal) | Red badge |

Rows with NO flags → "clean", eligible for AI-suggested bulk.
Rows with ANY flag → "needs attention", AI may NOT pre-select.

---

## AI can read

- The admin's queue: all `client_signed` rows with anomaly flags computed.
- Per row: full context (chef, client, shift, worked time, amount, deviation).
- Grouped views: by client, by chef, by deviation magnitude.
- Aggregate: total amount in queue, oldest row age.

---

## AI can draft

- **Clean-bulk preview**: "Er zijn 12 rijen zonder afwijkingen — wil je die voorbereiden voor goedkeuring? Klik 'Voorbereiden'."
- **Per-flagged-row summary**: "Marco's rij 14 juni heeft +30 min afwijking; gepland was 6u, werkelijk 6,5u. Reden chef: 'extra opruimen na sluiting'."
- **Group-by-chef view**: "Daniel heeft 3 rijen wachten; allemaal schoon; totaal 17u."
- **Rejection reason text**: if admin clicks "afwijzen" on a row, AI may suggest a reason phrasing.

---

## AI can execute only after explicit human confirmation

- **`hours.approve` (per row)** — admin clicks per-row checkbox + "Goedkeur 1 rij". Audit: `ai.hours.approve` paired with `shift_hours.admin_approved`.
- **`hours.bulk_approve`** — admin reviews the AI's "clean subset" preview, deselects any rows they want to look at, clicks "Goedkeur N geselecteerde". The action loops `approveHours` per id. Audit: `ai.hours.bulk_approve` PER ROW (no single bulk audit; each row gets its own pair).
- **`hours.reject_by_admin`** — admin clicks "Afwijzen" on a row with reason. Audit: `ai.hours.reject_by_admin`.

---

## AI must never do

- **Auto-tick flagged rows.** Anomaly flags are sticky — they remove the row from any AI-suggested bulk subset. Admin must un-flag (via review) to include.
- **Auto-approve "all 47 rows".** The user command "keur alle uren goed" is a regression test in `ai-evaluation-set.md`. The AI must REFUSE this and offer the clean subset.
- **Approve a row without showing the anomaly flag.** If a flag exists, the AI's preview MUST surface it.
- **Skip the per-row audit row.** Each approval is its own audit entry, full stop.
- **Suppress the chef's note.** If the chef wrote something in `shift_hours.notes`, the AI surfaces it.
- **Predict klant agreement.** "Hotel Pulitzer always signs immediately, so it's probably fine" — no. The AI grounds in data only.
- **Use historical performance as a reason to skip review.** Even a "trusted" chef's flagged row still needs review.

---

## Audit keys

System:

- `shift_hours.admin_approved`
- `shift_hours.admin_rejected`

AI-assisted (per row):

- `ai.hours.approve`
- `ai.hours.reject_by_admin`
- `ai.hours.bulk_approve` — one row per id approved in the bulk, NOT a single bulk row.

---

## Notifications

Per approval (same as [`hours-trust-chain.md`](./hours-trust-chain.md)):

| Event | In-app type | Email template |
|---|---|---|
| Admin approves | `hours_approved` to chef | `HoursApprovedChefEmail` + `HoursApprovedKlantEmail` |
| Admin rejects | `hours_rejected_by_admin` to chef + klant | `HoursRejectedByAdminEmail` |

Outbox:

- `hours.approved` → payroll provider per row (idempotency key `hours.approved:<hoursId>`).

For a bulk of 12 approvals: 12 outbox rows, 12 chef emails, 12 klant emails, 24 audit log rows (`ai.hours.approve` × 12 + `shift_hours.admin_approved` × 12).

---

## Edge cases

- **Row changed mid-bulk** (klant retracted somehow, admin re-approved a sibling row): atomic UPDATE for that row fails. Bulk continues for the rest; response includes "1 of 12 failed (row was stale)".
- **Email send fails** (Resend outage): approval succeeds (it's a DB transition), email goes into outbox retry queue. AI must NOT block approval on email send.
- **External payroll endpoint down**: same — `hours.approved` outbox row stays pending; worker retries.
- **Admin selects 100 rows in one bulk**: rate-limit on the server action (e.g. max 50 per click). UI warns; admin splits.
- **Bookkeeper role with read-only on identity but write on finance**: PR-CHEF-FUT. Until then, only `owner`/`super_admin`.
- **Two admins approving the same queue simultaneously**: each row has atomic UPDATE; whoever wins the race owns the audit. UI refreshes after each batch.
- **Approving a row that the chef has since cancelled the placement on**: cannot happen — `cancelShift` does not touch `shift_hours` (those are already drafted at `completed_auto`). Cancel of an `accepted`/`confirmed` placement is a different transition.

---

## Example user commands

### Admin

- "Welke uren wachten op mij?" → AI returns queue, grouped by `cleanSubset` vs. `needsAttention`.
- "Voorbereiden voor bulk-goedkeuring" → AI lists the clean subset; admin reviews the preview; admin clicks "Goedkeur N rijen".
- "Wat is er met Marco's 14 juni rij?" → AI surfaces flags + chef's note: "Gepland 6u, werkelijk 6,5u (+30 min). Chef-notitie: 'extra opruimen'. Klant heeft akkoord gegeven op 15 juni 09:14."
- "Keur alle uren goed" → AI refuses: "Ik kan niet alle 47 rijen blind goedkeuren. Wil je dat ik de 33 zonder afwijkingen voorbereid? De 14 met afwijkingen moet je per rij bekijken."
- "Wijs Daniel's 8 juni af want hij was te laat" → AI prepares reject with reason; admin clicks reject.

---

## Expected AI answer style

- **Surface flags PROMINENTLY.** Always before amount.
- **Group**: clean vs. needs-attention.
- **One-line per row in lists**: chef · client · date · worked · amount · flags.
- **Detail-on-demand**: don't dump 47 rows of detail; offer "wil je meer details van een specifieke rij?".
- **Refuse the bare "approve all"** with a counter-offer.
- **Show count, never percentage in preview**: "12 van 47" not "26%".
- **Cite the row IDs in the audit-friendly answer**: "Goedgekeurd: `hours #abc`, `hours #def`, ...".

---

## What this sub-flow optimizes for

Time savings without losing per-row signal. The trust chain only works if each `admin_approved` represents a real review. The AI's job is to surface the rows that *don't* need a review (clean subset) so the admin can spend time on the ones that do.

If you ever see the AI nudge toward "just bulk-approve all", that's a violation worth a P1 ticket.
