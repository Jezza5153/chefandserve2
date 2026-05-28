# Workflow: Client request cancellation (retract a pending submission)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 1.7 + Part 2** (klant-side). Ships with PR-KLANT-2 (`migration 0022_client_change_cancel.sql`).

## Purpose

A klant submits a shift request via `/client/request`; it lands as a `client_submissions` row that an admin triages and (later) converts into a `shifts` row. Before conversion the klant must be able to **retract** the request without leaving the portal or emailing anyone — otherwise they are trapped waiting on a request they no longer need.

This workflow covers ONLY the pre-conversion retraction (`new`/`triaged` → `cancelled_by_client`). Once a request has become a shift with a placement, the klant uses the heavier [`client-shift-change-request`](./client-shift-change-request.md) flow instead.

---

## Actors

- **Klant** — retracts own pending submission from `/client/requests`.
- **Admin (`owner`+)** — sees the retraction in `/admin/business/inbox`; no decision needed (it is a klant-initiated terminal state for the submission).
- **System** — emails the admin routable group that the klant cancelled.

---

## Source tables

- `client_submissions` — the request record. Status enum gains `cancelled_by_client`; new columns `cancelled_by_client_at`, `cancelled_by_client_reason`.
- `notifications`, `email_messages`, `email_events`.
- `audit_log`.

(No `shifts` row exists yet — that is the whole point of this flow being pre-conversion.)

---

## Human status labels

`client_submissions.status` as rendered on `/client/requests`:

| Backend | Dutch label |
|---|---|
| `new` | "Nieuw aangevraagd" |
| `triaged` | "In behandeling" |
| `converted` | (becomes a shift — see hub) |
| `cancelled_by_client` | "Geannuleerd door jou" |
| `rejected` | "Niet doorgegaan" |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| `new` | `cancelled_by_client` | klant (own) | submission belongs to caller; status IN (`new`,`triaged`) | `cancelRequest(submissionId, reason)` |
| `triaged` | `cancelled_by_client` | klant (own) | same | `cancelRequest(submissionId, reason)` |

Atomic guard: `UPDATE client_submissions SET status='cancelled_by_client', cancelled_by_client_at=now(), cancelled_by_client_reason=? WHERE id=? AND client_id=<own> AND status IN ('new','triaged')`. If 0 rows update (e.g. already converted to a shift), the action fails with "deze aanvraag is al opgepakt — gebruik 'Wijziging/annulering aanvragen' op de shift."

There is no transition back out of `cancelled_by_client`. A klant who changes their mind files a fresh request.

---

## AI can read

Through `client_request.list` (see [`../tool-contracts/client-request-tools.md`](../tool-contracts/client-request-tools.md)):

- The klant's own submissions with `humanStatus`, `nextStep`, and `canCancel` (true only when status IN `new`/`triaged`), per the proposed `ai_client_request_queue_view`.
- For admin: all submissions including cancelled-by-client.

AI cites `client_submissions.id`.

---

## AI can draft

- The cancellation `reason` text for the klant.
- A short summary of the pending request the klant is about to retract ("Sous-chef, vrijdag 31 mei, 17:00–23:00 — nog niet omgezet naar een shift").

---

## AI can execute only after explicit human confirmation

- **`client_request.cancel_pending`** — klant clicks "Annuleren" on the request row after seeing the AI's summary + drafted reason. Audit: `ai.client_request.cancel_pending`.

This is `assisted_execute` (Mode 3): a low-stakes retraction of the klant's *own* not-yet-converted request, but it still requires the klant's explicit click — the AI does not auto-cancel.

---

## AI must never do

- **Cancel a submission that has already converted** to a shift. Once converted, the path is the change/cancel-request flow; the AI must redirect, not force.
- **Cancel another klant's submission.** Ownership is verified server-side; the AI inherits klant RBAC.
- **Auto-cancel without the klant's click.** Even though it is the klant's own request, confirmation is required.
- **Invent a submission** that doesn't exist, or claim a cancellation succeeded when the atomic guard returned 0 rows.

---

## Audit keys

System:

- `client_submissions.cancelled_by_client`

AI-assisted:

- `ai.client_request.cancel_pending` (paired with `client_submissions.cancelled_by_client`)

---

## Notifications

Per `WORKFLOW.md` Part 4.2, reusing the `client_portal_request` routing event:

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Klant cancels pending submission | `client_request_cancelled` to admin recipients | `ClientChangeRequestAdminEmail` (or a cancellation variant) | admin routing for `client_portal_request` |

No email to the klant is strictly required (they performed the action), but a confirmation toast/notification is shown in-app.

---

## Edge cases

- **Race with conversion**: admin converts to a shift at the same moment the klant cancels. Atomic guard wins for whoever commits first. If conversion won, the klant's cancel returns 0 rows → AI explains and routes to the shift hub.
- **Empty reason**: `cancelRequest` accepts an optional reason; UI may require a minimum length. AI drafts a reason but never blocks on it.
- **Klant cancels then immediately re-requests**: allowed — a new `client_submissions` row is created. No link to the cancelled one.
- **Multi-day request**: the row may cover a date range; the AI summarises the range when confirming the retraction.

---

## Example user commands

### Klant (own)

- "Annuleer mijn aanvraag voor vrijdag." → AI summarises the matching `new`/`triaged` submission, drafts a reason, asks the klant to click "Annuleren".
- "Ik heb toch geen chef nodig volgende week." → AI checks `canCancel`; if the request is already a confirmed shift, it routes to the change/cancel-request flow instead.
- "Welke aanvragen heb ik nog openstaan?" → AI lists `new`/`triaged` submissions with next-step copy.

### Admin

- "Welke aanvragen heeft de klant zelf geannuleerd?" → AI lists `cancelled_by_client` rows.

---

## Expected AI answer style

- **Plain Dutch**, human labels only.
- **Confirm the exact request** before cancelling: role · date · time.
- **Route, don't force** when conversion already happened: "Deze aanvraag is al een shift geworden. Wil je een wijziging of annulering op de shift aanvragen?"
- **Cite**: "Bron: aanvraag #abc-123, status 'In behandeling'."
- **Never claim success** on a 0-row guard.
