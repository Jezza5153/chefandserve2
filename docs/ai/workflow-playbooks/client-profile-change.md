# Workflow: Client profile change (direct-edit vs. request-and-approve)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.3** (klant variant). Ships with PR-KLANT-1 (`migration 0021_client_change_requests.sql`).

## Purpose

A klant's profile mixes operational fields (who to call, where chefs report) with **finance-/identity-binding** fields (company name, KvK, BTW, login email, payment term, billing address). The first group is safe to edit instantly; the second must go through admin approval because it drives quotes, invoices, contracts, and Payingit. The profile UI is sectioned — **Contactpersoon · Shiftlocatie · Facturatie · Bedrijfsgegevens** — so the authority boundary is visible.

The split exists to prevent: silent payment-term changes a klant grants themselves, identity churn that breaks invoicing, and losing invoice access by changing `billingEmail` to a wrong address.

---

## Actors

- **Klant** — edits direct fields on `/client/profile`; files request-change for protected fields via "Verzoek wijziging".
- **Admin (`owner`+)** — reviews + approves/rejects protected-field requests in `/admin/business/clients/[id]` → "Wijzigingsverzoeken" tab.
- **System** — sends a confirmation email to the OLD billing email on a direct `billingEmail` change; fires `client.updated` outbox on approval.

---

## Source tables

- `clients` — the target row. Columns: `contactName`, `phone`, `billingEmail`, `shiftAddress`, `shiftArrivalNotes`, `city` (direct); `companyName`, `kvk`, `btw`, `email`, `paymentTermsDays`, `billingAddress` (request-change).
- `client_change_requests` — the proposal record (`field`, `currentValue`, `proposedValue`, `reason`, `status` enum `pending`/`approved`/`rejected`, `decidedBy`, `decisionNotes`).
- `notifications`, `email_messages`, `email_events`.
- `integration_outbox` — `client.updated` on approval (future Payingit/accounting sync).
- `audit_log`.

---

## Human status labels

`client_change_requests.status`:

| Backend | Dutch label |
|---|---|
| `pending` | "Wijziging aangevraagd, wacht op akkoord" |
| `approved` | "Goedgekeurd" |
| `rejected` | "Afgewezen" |

The profile page's "Wijzigingen in behandeling" list renders these with the field name (e.g. "Betaaltermijn wacht op akkoord · 1 dag geleden").

---

## Direct-edit vs. request-change field map

| Field | Authority | Section | Why |
|---|---|---|---|
| `contactName` | Direct | Contactpersoon | Operational |
| `phone` | Direct | Contactpersoon | Operational |
| `billingEmail` | Direct (with old-email confirmation) | Facturatie | Operational, but flags the OLD address |
| `shiftAddress` | Direct | Shiftlocatie | Affects only FUTURE shifts/templates — existing shifts snapshot location |
| `shiftArrivalNotes` | Direct | Shiftlocatie | Operational |
| `city` | Direct | Shiftlocatie | Operational |
| `companyName` | Request-change | Facturatie | On quotes + invoices + contracts |
| `kvk` | Request-change | Facturatie | Legal identity |
| `btw` | Request-change | Facturatie | Tax identity |
| `email` (auth/login) | Request-change | Bedrijfsgegevens | Login identifier |
| `paymentTermsDays` | Request-change | Facturatie | **Finance term — never klant-self-editable** |
| `billingAddress` | Request-change | Facturatie | Invoicing |

**`paymentTermsDays` is admin-controlled** (also recorded in `source-of-truth-map.md`). The klant *requests*; an admin approves.

---

## Allowed transitions

Direct fields: instant `UPDATE clients SET <field>=? WHERE id=? AND <ownership>` + audit `client.profile_updated` + outbox `client.updated`.

Request-change fields:

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `pending` | klant (own) | protected field; no existing `pending` request for same field; reason optional | `requestClientChange(field, proposedValue, reason)` |
| `pending` | `approved` | admin (`owner`+) | row `pending`; current value still matches request-time value | `approveClientChange(reqId, decisionNotes)` (atomic 2-UPDATE: applies to `clients`, marks request) |
| `pending` | `rejected` | admin (`owner`+) | row `pending`; decisionNotes provided | `rejectClientChange(reqId, decisionNotes)` |

Atomicity on approve mirrors the chef flow: `UPDATE clients SET <field>=<proposed> WHERE id=? AND <field>=<currentValueAtRequestTime>` then `UPDATE client_change_requests SET status='approved' WHERE id=? AND status='pending'`. If either updates 0 rows → "verzoek is niet meer actueel".

---

## AI can read

Through `client.read`, `client_request.list` (see [`../tool-contracts/client-tools.md`](../tool-contracts/client-tools.md)):

- The klant's own current profile (all sections), for that klant or admin.
- For klant: own pending/historical `client_change_requests`.
- For admin: all pending requests grouped by client.

AI answers "welke wijzigingen heb ik aangevraagd?" by reading own rows; cites `client_change_requests.id`.

---

## AI can draft

- **Klant-side**: a `client.draft_profile_change` payload (proposed value + reason phrasing) for a protected field.
- **Admin-side**: draft `decisionNotes` for approve or reject.
- An explanation of *why* a field is locked ("Betaaltermijn staat op je facturen en afspraken, daarom kijken we er eerst naar.").

---

## AI can execute only after explicit human confirmation

- **`client.submit_profile_change`** — klant clicks "Verzoek versturen" after AI drafts. Audit: `ai.client.submit_profile_change`.
- **Direct-field save** (`client.update_direct_field`, e.g. phone) — klant clicks "Opslaan". Audit: `ai.client.update_direct_field`.

Admin approve/reject is itself a Mode-3 action but lives in the admin tooling; the AI may surface + draft notes, never auto-decide.

---

## AI must never do

- **Directly change `paymentTermsDays`** — never, not even with confirmation. It is request-change only; the AI may draft the request, an admin approves.
- **Approve a klant's own change request.** Approval is an admin action; `client.approve_change` does not exist for the klant role.
- **Edit a protected field via the direct path** to "save the klant a step". The only path is the request flow.
- **Change `billingEmail` without surfacing the old-email confirmation.** The AI must mention that a confirmation goes to the OLD address with a 7-day rollback window.
- **Recommend a payment term from training data** ("hotels usually get 60 days"). Cite the klant's actual `paymentTermsDays` or stop.
- **Hide a pending request** when the klant asks about a field that already has one open.

---

## Audit keys

System:

- `client.profile_updated` (direct field applied — the actual mutation)
- `client.change_requested`
- `client.change_approved` (paired with the `client.profile_updated` mutation on approval)
- `client.change_rejected`

AI-assisted:

- `ai.client.update_direct_field`
- `ai.client.submit_profile_change`

The `before`/`after` JSON for `client.change_approved` MUST include field + old value + new value.

---

## Notifications

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Klant submits request | `client_change_request` to admin recipients | `ClientChangeRequestAdminEmail` | admin routing |
| Admin approves | `client_change_decided` to klant | `ClientChangeRequestOutcomeKlantEmail` | `recipientsForClient(clientId, 'generic')` |
| Admin rejects | `client_change_decided` to klant | `ClientChangeRequestOutcomeKlantEmail` | `recipientsForClient(clientId, 'generic')` |
| Direct `billingEmail` change | (email only) | `BillingEmailChangedKlantEmail` to **OLD** address | the prior `billingEmail` literal |

Outbox: `client.updated` → future Payingit/accounting sync, idempotency `client.updated:<clientId>:<v>`.

---

## Edge cases

- **Klant edits a protected field while a pending request exists**: server rejects with "je hebt al een verzoek openstaan voor dit veld."
- **`billingEmail` typo'd to a wrong address**: confirmation email to OLD address gives a 7-day "niet jij gedaan?" rollback window. AI explains this safeguard.
- **`shiftAddress` change vs. existing shifts**: only FUTURE requests/templates use the new address; existing shifts keep their snapshotted `shifts.location`. AI must NOT claim an existing shift's location changed.
- **Concurrent admin decisions**: atomicity guards both; the loser sees stale + retries.
- **`paymentTermsDays` requested 14 → 60**: row created, admin email fired, admin approves in the tab → `clients.paymentTermsDays=60` + klant outcome email. AI never shortcuts this.
- **Klant asks AI to "just set my company name"**: AI explains it is a request-change field and offers to draft the request.

---

## Example user commands

### Klant (own)

- "Mijn telefoonnummer is veranderd." → AI: "Telefoon kun je direct aanpassen. [Open profiel]" (no request).
- "Zet mijn betaaltermijn op 60 dagen." → AI: "Betaaltermijn is een verzoek-veld. Ik kan een aanvraag voorbereiden (14 → 60 dagen) met een korte reden. Akkoord?"
- "Wijzig mijn facturatie-e-mail naar finance@hotel.nl." → AI: "Dat kun je direct. Let op: we sturen een bevestiging naar je huidige adres met een terugdraai-optie van 7 dagen. [Open profiel]"
- "Status van mijn KvK-wijziging?" → AI reads own `client_change_requests`.

### Admin

- "Welke klant-wijzigingsverzoeken liggen op mij?" → AI lists `pending`, grouped by client.
- "Keur de betaaltermijn-wijziging van Hotel X goed." → AI shows old/proposed value + reason, asks for notes; admin confirms.

---

## Expected AI answer style

- **For klant**: state which fields are direct vs. request, and *why* the protected ones are protected.
- **For admin**: surface OLD value, PROPOSED value, REASON before asking to confirm.
- **Cite the request**: "Verzoek `ccr #abc-123`."
- **Surface the old-email safeguard** on any `billingEmail` change.
- **Never present "auto-approve" or a direct edit of a protected field** as an option.
