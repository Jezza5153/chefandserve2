# Workflow: Client contact routing (recipientsForClient)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 4** (event map / routing). Ships with PR-KLANT-0 (`client_contacts` table; V2 seam — no UI in V1).

## Purpose

Every klant-facing transactional email must resolve "who at the klant should receive this?" through **one** function: `recipientsForClient(clientId, event)` in [`src/lib/domain/client-recipients.ts`](../../../src/lib/domain/client-recipients.ts). No call site ever hard-codes `client.email`. This is the seam that lets a single-recipient V1 grow into multi-recipient V2 (planning / onsite / finance / hours_approval / emergency contacts) **without a schema migration or a rewrite of every email send**.

V1: returns the main `clients.email` (or `clients.billingEmail` for finance-flavoured events). V2: when `client_contacts` has rows, resolves by role with a V1 fallback. The AI's job is to *explain* who gets which email; it never sends on the klant's behalf without confirmation.

---

## Actors

- **System** — every email-sending path (PR-KLANT-1…5) calls `recipientsForClient()`.
- **Admin (`owner`+)** — in V2, manages `client_contacts` rows (no UI in V1; the table is the seam).
- **Klant** — in V2, is reachable via role-specific contacts; in V1, a single email.

---

## Source tables

- `clients` — `email`, `billingEmail` (the V1 fallback recipients).
- `client_contacts` — V2 seam. Columns: `client_id`, `name`, `email`, `phone`, `role` enum (`planning`/`onsite`/`finance`/`hours_approval`/`emergency`), `receives_notifications boolean`. **Empty in V1** — so the role-resolution path is a no-op until contacts are added.
- `email_messages`, `email_events` — every send recorded via `recordEmailMessage()`.

---

## Human status labels

This is a routing helper, not a stateful workflow — there are no status enums. The relevant "labels" are the event keys and the roles they map to.

---

## The event → role map (V1 fallback vs. V2 roles)

`ClientEmailEvent` + `EVENT_ROLE_MAP` from `client-recipients.ts`:

| `event` (eventKey) | V2 role(s) | V1 fallback |
|---|---|---|
| `chef_proposed` | `planning`, `onsite` | `clients.email` |
| `hours_ready_to_sign` | `hours_approval` | `clients.email` |
| `billing_email_changed` | `finance` | `clients.billingEmail` (→ `clients.email`) |
| `client_shift_change_requested` | `planning`, `emergency` | `clients.email` |
| `rating_pending` | `planning` | `clients.email` |
| `generic` | (none) | `clients.email` (→ `billingEmail`) |

Resolution order inside `recipientsForClient`:

1. **V2**: active `client_contacts` rows whose `role` is in the event's role set AND `receives_notifications = true` → their emails.
2. **V1 fallback**: `billingEmail` for `billing_email_changed`, else `clients.email`. Always returns at least the fallback if one exists.
3. Result is de-duplicated + lowercased. Empty only if the klant has no usable email (caller skips the send).

---

## Allowed transitions

Not a state machine. The "transitions" are V1 → V2 routing behaviour, which changes *only* by inserting `client_contacts` rows (an admin action, V2):

| From | To | Actor | Effect |
|---|---|---|---|
| no contacts (V1) | `client_contacts` row(s) exist (V2) | admin | events route by role; fallback still applies when no matching role/contact |

Adding a contact never changes which *events* exist — only which addresses an event resolves to.

---

## AI can read

Through `client.read` (admin scope) + the helper's documented map:

- For admin: which addresses a given `(clientId, event)` would resolve to (V1 = the single email; V2 = the role-matched contacts).
- The event → role map itself (it is documentation, broadly readable).

The AI explains routing; it cites the event key and the resolved address(es).

---

## AI can draft

- An explanation of who receives which klant email ("Urengoedkeuring-mails gaan in V1 naar je hoofdadres; zodra je een 'hours_approval'-contact toevoegt, gaan ze daarheen.").
- For admin (V2): a draft `client_contacts` row (name, email, role) — draft only; the admin creates it via the (future) UI.

---

## AI can execute only after explicit human confirmation

- The AI does **not** send klant email on the klant's behalf without confirmation. Any send is driven by the originating workflow (chef proposed, hours to sign, etc.), each of which is its own Mode-3 action with its own confirmation button.
- Creating a `client_contacts` row (V2) is an admin UI action; the AI may draft, the admin confirms.

There is no standalone "send email" tool the AI can call here.

---

## AI must never do

- **Send a klant email on the klant's behalf without confirmation.** Routing is plumbing; the *send* always belongs to a confirmed workflow.
- **Hard-code or bypass `recipientsForClient`.** The AI must reason about recipients only through this helper's map, never by guessing an address.
- **Expose `client_contacts` emails/phones to a non-admin** (or to a chef). Contact details are klant-own + admin.
- **Invent a role** outside the `client_contact_role` enum.
- **Claim an email went to a role-contact in V1** when the table is empty — V1 resolves to the single fallback.

---

## Audit keys

System (from the originating send, not the helper itself):

- `email.message_recorded` (via `recordEmailMessage()` on every send)
- `client_contacts.created` / `.updated` (V2 admin actions)

AI-assisted:

- `ai.client.explain_routing` (read/explain)

---

## Notifications

This workflow *is* the routing layer for notifications/emails; it doesn't fire its own. Each consuming event (see the map above) creates its in-app `notification` + email per its own playbook, resolving recipients here.

---

## Edge cases

- **V1, no contacts**: every event resolves to `clients.email` (or `billingEmail` for finance). AI must not claim role-based routing happened.
- **`billing_email_changed`**: prefers `billingEmail`, falls back to `email`. The OLD-address confirmation email (see [`client-profile-change`](./client-profile-change.md)) is sent to the literal prior address, not via this helper.
- **Klant with no email at all**: `recipientsForClient` returns `[]`; the caller skips the send. AI surfaces "geen e-mailadres bekend" rather than pretending a mail went out.
- **V2, role present but `receives_notifications=false`**: that contact is excluded; fallback applies if no other role matches.
- **Duplicate addresses across roles**: de-duplicated + lowercased in the result.

---

## Example user commands

### Klant (own)

- "Wie krijgt de mail als jullie een chef voorstellen?" → AI: "In V1 je hoofdadres ({email}). Met een planning- of onsite-contact gaat het daarheen."
- "Kan facturatie naar een ander adres?" → AI explains finance events resolve to `billingEmail`, and directs to the profile flow to set it.

### Admin

- "Naar wie gaat de urengoedkeuring-mail voor Hotel X?" → AI resolves `(clientId, 'hours_ready_to_sign')` and reports the address(es).
- "Voeg een finance-contact toe voor Hotel X." → AI drafts the `client_contacts` row; admin creates it (V2).

---

## Expected AI answer style

- **Be explicit about V1 vs. V2.** Don't imply role-routing exists before contacts are added.
- **Always reason via `recipientsForClient`**, never a guessed address.
- **Protect contact PII**: emails/phones only to admin/klant-own.
- **Cite the event key**: "Event `hours_ready_to_sign` → rol `hours_approval` (V2) / hoofdadres (V1)."
- **Never send** on the klant's behalf without a confirmed originating action.
