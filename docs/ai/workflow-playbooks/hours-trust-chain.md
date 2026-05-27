# Workflow: Hours trust chain (chef → klant → admin → exported)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.1**. Ships with PR-CHEF-1.

## Purpose

A shift happens. We need a single, irrevocable record of how many hours were actually worked, signed by both sides, approved by an admin, and finally exported to payroll. The chain is the trust mechanism — every step is a fresh consent.

This is the single most important workflow in the system. Every step is atomic; every step is auditable; every step has a clear next actor; once a row is `exported`, it is append-only.

---

## Actors

- **Chef** — submits hours (`shift_hours.submit`).
- **Klant** — signs or rejects hours (`shift_hours.client_sign` / `client_reject`).
- **Admin (`owner` / `super_admin` / future bookkeeper)** — approves, rejects, or creates a correction.
- **System worker** — `workers/complete-placements.ts` flips `confirmed` → `completed` and creates the draft `shift_hours` row.
- **System worker** — `workers/hours-reminders.ts` sends 24/72h chef nudges and 5d klant timeouts.
- **System worker** — `workers/payroll-export.ts` flips `admin_approved` → `exported` on batch export.

---

## Source tables

- `placements` — the (chef, shift) link. Drives auto-completion.
- `shifts` — the underlying client request.
- `shift_hours` — the trust-chain row. Lifecycle enum `shift_hours_status`.
- `shift_hour_corrections` — append-only corrections after export.
- `payroll_batches`, `payroll_batch_lines` — the export grouping.
- `integration_outbox` — fires external events (payroll provider).
- `notifications` — drives the in-app inbox.
- `email_messages`, `email_events` — every transactional email.
- `audit_log` — every mutation.

---

## Human status labels

Mapping via `src/lib/hours-labels.ts` (PR-CHEF-1 ships this). Backend → Dutch UI:

| Backend status | Dutch label | Who sees it |
|---|---|---|
| `draft` | "In te dienen door chef" | Chef + admin |
| `submitted` | "Wacht op klant" | Chef + klant + admin |
| `client_signed` | "Ondertekend door klant, wacht op admin" | Chef + klant + admin |
| `client_rejected` | "Afgewezen door klant" | Chef + klant + admin |
| `admin_approved` | "Goedgekeurd door admin" | Chef + klant + admin |
| `admin_rejected` | "Afgewezen door admin" | Chef + klant + admin |
| `exported` | "Verwerkt voor uitbetaling" | Chef + klant + admin |
| `void` | "Geannuleerd" | Admin only |

**The AI MUST use these labels.** Surfacing the raw enum (e.g. `'admin_approved'`) in chat is a regression test in `ai-evaluation-set.md`.

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `draft` | system worker (`complete-placements`) | `placement.status = 'confirmed'` AND `shift.endsAt < now() - 1h` | INSERT `shift_hours` (idempotent on placementId UNIQUE) |
| `draft` | `submitted` | chef (own) | chef owns placement; `startedAt`/`endedAt`/`breakMinutes` valid | server action `submitHours` |
| `client_rejected` | `submitted` | chef (own) | chef owns placement; reason field reviewed | `submitHours` (re-submit) |
| `submitted` | `client_signed` | klant (own) | klant owns the shift's client | `signHours` |
| `submitted` | `client_rejected` | klant (own) | reason required | `rejectHours` (client side) |
| `client_signed` | `admin_approved` | admin (`owner`+) | row is `client_signed` | `approveHours` |
| `client_signed` | `admin_rejected` | admin (`owner`+) | reason required | `rejectHours` (admin side) |
| `admin_approved` | `exported` | system (`workers/payroll-export.ts`) | row is included in an exported `payroll_batch` | batch export flow |
| any non-final | `void` | admin (`owner`+) | reason required; rare; only for clearly-erroneous rows that cannot be recovered via re-submit | `voidHours` (admin) |

Post-export mutations: NONE. The row is immutable. Corrections happen via `shift_hour_corrections`.

### Atomicity

Every transition uses `UPDATE shift_hours SET status = '<new>' WHERE id = ? AND status = '<expected>'`. If 0 rows update, the request is stale and the action is rejected with a "deze rij is alweer veranderd" message.

---

## AI can read

Through `hours.list_queue`, `hours.read`, `hours.summarize` (see [`../tool-contracts/hours-tools.md`](../tool-contracts/hours-tools.md)):

- Status of any `shift_hours` row the caller has access to (own-only for chef/klant; all for admin).
- Schedule deviation (worked minutes vs. scheduled `(shift.endsAt - shift.startsAt) - breakMinutes`).
- Rate computed for chef + client portions.
- Timeline (`submittedAt`, `clientSignedAt`, `adminApprovedAt`, `payrollExportedAt`).
- Anomaly flags from the proposed `ai_hours_queue_view` (e.g. `scheduleDeviation`, `rateOverride`).
- Whether a payroll export has happened.

The AI may answer "wanneer wordt 8 juni betaald?" by tracing the chain. It cites the `shift_hours.id` in its answer.

---

## AI can draft

- Chef reminder ("vul je uren in" / "submit je uren") — `hours.draft_reminder`. Output is a draft email + suggested notification body; chef may choose channel.
- Klant reminder ("teken je uren") — similar.
- Admin "klant heeft niet getekend na 5 dagen" report — list grouped by client.
- Admin "ready to approve queue" — list with anomaly flags first.
- Klant "uitleg over hoe uren tekenen" — explanation, no action.

Drafts may be sent ONLY via `notifications.send` after explicit click. See [`../tool-contracts/notification-tools.md`](../tool-contracts/notification-tools.md).

---

## AI can execute only after explicit human confirmation

- **`hours.approve`** — admin clicks "Goedkeuren" in the AI preview. Audit: `ai.hours.approve`.
- **`hours.reject_by_admin`** — admin clicks "Afwijzen", provides reason. Audit: `ai.hours.reject_by_admin`.
- **`hours.bulk_approve`** — admin reviews subset, clicks "Goedkeur 5 geselecteerde". The AI may NOT generate "approve all" — only an admin-curated subset. Audit: `ai.hours.bulk_approve` PER ROW (no single bulk audit; each approval is a separate row for forensic clarity).
- **`hours.create_correction`** — admin clicks "Correctie aanmaken" with positive or negative delta + reason. Two-eye principle: a different admin must approve via `hours.approve_correction`. Audit: `ai.hours.create_correction`.
- **`hours.send_reminder`** — admin clicks "Verstuur herinnering nu". Audit: `ai.hours.send_reminder`.

For the **chef** and **klant** sides, the AI may NOT execute on the user's behalf even with confirmation — the chef must press "Indien" and the klant must press "Akkoord" themselves on a non-AI page. The AI's role is to OPEN the right form (deep-link) but not click submit. See [`../ai-safety-rules.md`](../ai-safety-rules.md) hard rule #4.

---

## AI must never do

- **Approve hours autonomously.** Even with confirmation, the admin must read the row first. The AI's job is to surface the row, not click for the admin.
- **Sign hours on the klant's behalf.** This is impersonation. The klant clicks "Akkoord" themselves.
- **Submit hours on the chef's behalf.** Same reason.
- **Mutate an `exported` row.** Append-only.
- **Bypass the two-eye principle on corrections.** The same admin who created a correction cannot approve it; the AI cannot help here.
- **Hide the schedule deviation flag.** If a worked period differs from the scheduled period by >15 min, the AI MUST surface this.
- **Invent a delivery status from Payingit.** The chain ends at `exported`. Anything after that requires reading `email_events` or external system, and the AI should say "geen verdere statusinformatie beschikbaar" rather than guess.

---

## Audit keys

System (per `WORKFLOW.md` Part 6 "Planned audit actions"):

- `placements.completed_auto`
- `shift_hours.draft_created`
- `shift_hours.submit`
- `shift_hours.client_signed`
- `shift_hours.client_rejected`
- `shift_hours.admin_approved`
- `shift_hours.admin_rejected`
- `shift_hours.exported` (set when batch exports)
- `shift_hours.void`
- `shift_hour_corrections.created`
- `shift_hour_corrections.approved`

When the AI executes (Mode 3), audit keys get the `ai.` prefix:

- `ai.hours.approve` (paired with `shift_hours.admin_approved`)
- `ai.hours.reject_by_admin` (paired with `shift_hours.admin_rejected`)
- `ai.hours.bulk_approve` (paired with each `shift_hours.admin_approved`)
- `ai.hours.create_correction`
- `ai.hours.send_reminder`

The paired pattern: an AI-assisted approval writes TWO audit rows — `ai.hours.approve` first (with `before`/`after` showing the AI's suggestion), then `shift_hours.admin_approved` (the actual state mutation). This lets us answer "which approvals did Maarten do alone vs. with AI help?" forensically.

---

## Notifications

Per `WORKFLOW.md` Part 4.2:

| Event | In-app type | Email template |
|---|---|---|
| Worker creates draft | `hours_to_log` to chef | (no email — chef sees on dashboard) |
| Chef submits | `hours_to_sign` to klant | `HoursSubmittedKlantEmail` |
| Klant signs | `hours_signed` to chef + `hours_ready_to_approve` to admin recipients | `HoursSignedChefEmail` + `HoursSignedAdminEmail` |
| Klant rejects | `hours_rejected_by_klant` to chef | `HoursRejectedByKlantChefEmail` |
| Admin approves | `hours_approved` to chef | `HoursApprovedChefEmail` + `HoursApprovedKlantEmail` |
| Admin rejects | `hours_rejected_by_admin` to chef | `HoursRejectedByAdminEmail` (chef + klant) |
| 24/72h chef nudge | (in-app + email) | `HoursReminderChefEmail` |
| 5d klant nudge | (in-app + email, admin cc) | `HoursReminderKlantEmail` |

Outbox events:

- `hours.submitted` → internal
- `hours.client_signed` → internal
- `hours.approved` → payroll provider (this is the one that matters externally)
- `payroll_batch.exported` → payroll provider (batch granularity)
- `correction.ready` → payroll (picked up by next batch)

---

## Edge cases

- **Stale row** (someone else updated meanwhile): atomic UPDATE fails (0 rows), action returns "deze rij is alweer veranderd, ververs de pagina". AI surfaces this gracefully.
- **Klant ignores the row for 5 days**: `hours-reminders.ts` worker fires admin "hours_klant_timeout" notification. Admin can manually force-approve via `manualForceApprove(reason)` — distinct path, with its own audit `shift_hours.admin_force_approved`. AI may draft the reasoning but never execute.
- **Chef cancelled placement after `confirmed` and before `completed`**: `complete-placements.ts` skips placements where `cancelledAt IS NOT NULL`. No draft row is created. AI explains: "dienst is geannuleerd, geen uren te verwerken".
- **Chef resubmits after `client_rejected`**: the same row goes back to `submitted`. The chain restarts but the row id stays the same — easier to trace.
- **Admin rejects after `client_signed`**: row goes to `admin_rejected`. Chef + klant both get notified. Chef cannot resubmit a rejected-by-admin row; an admin must `void` and the chef opens a new flow (via the next placement or a manual placement).
- **Manual-add hours (admin types a row from scratch)**: `manualAddHours` — bypasses chef + klant, creates row at `admin_approved` directly. Audit key `shift_hours.admin_created (manual)`. AI may draft the row + show preview, never auto-create.
- **Schedule deviation > 15 min**: anomaly flag set; UI shows yellow badge; admin must explicitly acknowledge before approving. AI's `hours.summarize` must surface this flag PROMINENTLY.
- **Rate override** (placement's `chefRateCents` differs from shift's): anomaly flag set. Admin must acknowledge. AI surfaces.

---

## Example user commands

### Chef (own)

- "Wat moet ik nu doen?" → AI lists own `draft` and `client_rejected` rows.
- "Wanneer wordt mijn 8 juni dienst uitbetaald?" → AI traces the chain.
- "Vul mijn uren in voor 8 juni" → AI opens the form `/chef/hours/[placementId]`; does NOT pre-fill submit.

### Klant (own)

- "Welke uren moet ik tekenen?" → AI lists own `submitted` rows.
- "Akkoord met Sophie's uren" → AI refuses; redirects to the sign page where the klant clicks "Akkoord" themselves.
- "Waarom moet ik dit tekenen?" → AI explains the chain (with a citation to the public privacy doc).

### Admin

- "Welke uren wachten op mij?" → AI lists `client_signed` rows.
- "Goed te keuren op basis van match met schema?" → AI returns subset with no anomaly flags, asks confirm.
- "Stuur Daniel een herinnering" → AI drafts → admin confirms → `notifications.send` called.
- "Maak een correctie voor 8 juni Daniel +0,5u, reden: extra schoonmaak" → AI drafts the correction row + preview; admin clicks "Aanmaken"; a DIFFERENT admin gets the approval notification.

---

## Expected AI answer style

- **Plain Dutch.** Never raw English status strings.
- **Cite the record.** "Bron: `shift_hours #abc-123`, ingediend op 8 juni 09:15."
- **Show next action.** "Volgende stap: jij (klant) tekent of wijst af. [Open ondertekenscherm]"
- **Surface anomalies.** If the row has a `scheduleDeviation` flag, mention it before any rate or amount.
- **Stop at `exported`.** Do not speculate about Payingit-side delivery.
- **One row at a time.** When listing multiple, group by next-actor first, then by overdue-ness.

### Sample answer (admin)

> "5 rijen wachten op jou (sinds langste 2 dagen):
> - Daniel @ Lute 8 juni — 8 uur, geen afwijkingen. [Goedkeuren]
> - Marco @ Pulitzer 9 juni — 6,5u (gepland 6), afwijking +30 min. [Goedkeuren met aandacht]
> - Sophie @ Lute 10 juni — afgewezen door klant, in afwachting van Sophie's reactie.
> - …
>
> Wil je dat ik de 4 zonder afwijkingen voorbereid voor bulk-goedkeuring? Je klikt zelf 'Bulk goedkeuren'."
