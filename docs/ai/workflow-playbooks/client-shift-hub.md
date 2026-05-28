# Workflow: Client shift hub (the klant's single source of truth)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2** (klant-side, PR-KLANT-0 keystone). Ships with PR-KLANT-0.

## Purpose

`/client/shifts/[shiftId]` is the one page a hotel ever needs to open about a shift. It answers, in fixed order: what is the status, **"Wat gebeurt er nu?"**, which chef(s) are proposed/confirmed, where the hours stand, whether feedback is due, and which actions are available right now. No raw backend status ever reaches this page — every status is rendered through `getClientShiftLabel()` from [`src/lib/client-shift-labels.ts`](../../../src/lib/client-shift-labels.ts), which returns `{ humanStatus, nextStep, allowedActions[] }`.

The hub is **canonical**: every shift-related dashboard card links here first. Only truly global actions (nieuwe aanvraag, agenda, profiel) bypass it. The AI's job on this surface is to explain the current state and the next step, and to deep-link the klant to the correct action — never to fabricate a status or invent a chef.

---

## Actors

- **Klant** — reads the hub; sends comments on proposed chefs; opens change/cancel-request modals; signs/rejects hours (on the hours sub-page); rates the chef (on the rate sub-page).
- **Admin (`owner` / `super_admin`)** — proposes/confirms chefs, replies to klant comments (`visibility='client_visible'`), resolves change/cancel requests.
- **Chef** — works the shift; submits hours. Not a reader of this klant-scoped page.
- **System worker** — `workers/complete-placements.ts` flips `confirmed` → `completed` and creates the `shift_hours` draft, which changes what the hub shows.

---

## Source tables

- `shifts` — the underlying request; `shifts.location` / `shifts.city` are **snapshotted at creation** (profile edits never rewrite an existing shift).
- `placements` — the (chef, shift) link; drives the proposed/accepted/confirmed/cancelled chef cards.
- `placement_comments` — the **only** comment store rendered here (via `listVisibleComments`); `placements.notes` is NEVER read for this page.
- `shift_hours` — drives the "Uren" pill once a chef has worked.
- `ratings` — drives the "Feedback" section once hours are `admin_approved` (PR-KLANT-5).
- `client_shift_change_requests` — open change/cancel requests shown inline (PR-KLANT-2).
- `notifications`, `email_messages` — what brought the klant here.

---

## Human status labels

From `getClientShiftLabel()`. Hours lifecycle takes precedence once a `shift_hours` row exists; otherwise the placement lifecycle drives; otherwise the shift is "Wacht op planning".

| Backend source | Dutch label (`humanStatus`) | Who sees it |
|---|---|---|
| `shift.open` / no placement | "Wacht op planning" | Klant + admin |
| `placement.proposed` | "Chef voorgesteld" | Klant + admin |
| `placement.accepted` | "Chef heeft toegezegd" | Klant + admin |
| `placement.confirmed` | "Shift bevestigd" | Klant + admin |
| `placement.rejected` | "Chef niet beschikbaar" | Klant + admin |
| `placement.no_show` | "Chef niet verschenen" | Klant + admin |
| `placement.cancelled` | "Geannuleerd" | Klant + admin |
| `shift_hours.draft` | "Uren nog niet ingediend" | Klant + admin |
| `shift_hours.submitted` | "Uren wachten op jouw akkoord" | Klant + admin |
| `shift_hours.client_signed` | "Door jou akkoord" | Klant + admin |
| `shift_hours.client_rejected` | "Uren teruggegeven aan chef" | Klant + admin |
| `shift_hours.admin_approved` | "Goedgekeurd voor uitbetaling" | Klant + admin |
| `shift_hours.admin_rejected` | "Uren in correctie" | Klant + admin |
| `shift_hours.exported` | "Afgerond" | Klant + admin |

**The AI MUST use these labels** and MUST always pair them with the `nextStep` line. Surfacing a raw enum (e.g. `'admin_approved'`, `'proposed'`) is a regression test in `ai-evaluation-set.md`.

---

## Allowed transitions

The hub itself does not own state transitions — it is a read+route surface. Its `allowedActions[]` whitelist (per status) governs which buttons render. The actual mutations live in the linked workflows.

| Status | `allowedActions[]` | Maps to playbook |
|---|---|---|
| `shift.open` (no placement) | `cancel_request` | [`client-shift-change-request`](./client-shift-change-request.md) |
| `placement.proposed` | `comment` · `change_request` · `cancel_request` | [`chef-preview-comment`](./chef-preview-comment.md), [`client-shift-change-request`](./client-shift-change-request.md) |
| `placement.accepted` | `change_request` · `cancel_request` | [`client-shift-change-request`](./client-shift-change-request.md) |
| `placement.confirmed` | `change_request` · `cancel_request` · `contact` | [`client-shift-change-request`](./client-shift-change-request.md) |
| `placement.rejected` | `cancel_request` | [`client-shift-change-request`](./client-shift-change-request.md) |
| `placement.no_show` / `completed` | `contact` | — |
| `placement.cancelled` | (none) | — |
| `shift_hours.submitted` | `sign_hours` · `reject_hours` · `contact` | [`client-hours-signing`](./client-hours-signing.md) |
| `shift_hours.admin_approved` / `exported` | `rate_chef` (+`contact`) | [`client-rating-feedback`](./client-rating-feedback.md) |
| any other hours status | `contact` | — |

`actionAllowed(label, action)` is the helper that gates each button. The hub never traps the klant: change/cancel-request is reachable on every non-final placement status.

---

## AI can read

Through `client.read` + the proposed `ai_client_shift_summary_view` (see [`../tool-contracts/client-tools.md`](../tool-contracts/client-tools.md)):

- The shift header (company, date/time, role, snapshotted `shifts.location`).
- The `humanStatus` + `nextStep` for the asking klant's own shift.
- Proposed/confirmed chef cards using ONLY `clientVisible` fields (name, vakniveau, ervaring, languages; photo only if `clientVisible+verified`).
- The hours pill (human-labelled) and whether feedback is due.
- Klant-visible comments only: `listVisibleComments(placementId, { kind: 'client' })` → rows where `visibility='client_visible'`.
- Open `client_shift_change_requests` for the shift (status + when filed).

The AI cites the record: "Bron: shift #abc-123, status 'Chef voorgesteld'."

---

## AI can draft

- A plain-Dutch explanation of the current status + next step for the klant.
- A comment on a proposed chef (→ `chef-preview-comment` flow; draft only).
- A change-request or cancel-request body (→ `client-shift-change-request` flow; draft only).
- For admin: a summary of "which shifts are waiting on the klant" (grouped by next-actor).

Drafts never mutate. The klant acts via the existing UI buttons.

---

## AI can execute only after explicit human confirmation

The hub aggregates other workflows; execution always belongs to the linked workflow's tool:

- Sending a comment → klant clicks "Stuur opmerking" (see [`chef-preview-comment`](./chef-preview-comment.md)). Audit: `ai.client.add_comment`.
- Filing a change/cancel request → klant clicks "Verzoek versturen" (see [`client-shift-change-request`](./client-shift-change-request.md)).
- Signing hours → klant clicks "Akkoord" on the hours sub-page themselves (the AI never clicks for them).

There is **no hub-level execute tool**. The hub is read + route.

---

## AI must never do

- **Fabricate a status.** If `getClientShiftLabel()` has no row, the AI says "ik kan de status niet ophalen", never guesses.
- **Read `placements.notes`** to answer a klant question. Use `placement_comments WHERE visibility='client_visible'` or `ai_client_shift_summary_view`. (Hard rule — `rag-source-catalog.md`.)
- **Reveal a chef's internal ratings** on a proposed-chef card. Ratings are internal-only V1.
- **Expose a non-`clientVisible` chef field or document** (e.g. phone of a not-yet-confirmed chef, an unverified photo).
- **Sign hours, approve hours, or confirm a chef on the klant's behalf.**
- **Show a "Akkoord?"/"Goedkeuren?" affordance on a proposed chef** — the klant has view+comment only, no veto.

---

## Audit keys

The hub is read-only, so system audit comes from the workflows it aggregates:

- `placement_comments.created` (klant comment)
- `client_shift_change_requests.created` (change/cancel request)
- `shift_hours.client_signed` / `.client_rejected` (hours sub-page)
- `ratings.created` (rate sub-page)

AI reads emit `ai.client.read_shift` / `ai.tool_invoked`. No write audit originates on the hub itself.

---

## Notifications

The hub is the `actionUrl` target for most klant notifications (per `WORKFLOW.md` Part 4.2):

| Event | In-app type | actionUrl |
|---|---|---|
| Chef proposed | `chef_proposed` → klant | `/client/shifts/[shiftId]` |
| Hours to sign | `hours_to_sign` → klant | `/client/shifts/[shiftId]/hours` |
| Change/cancel decided | `client_shift_change_decided` → klant | `/client/shifts/[shiftId]` |
| Rating pending | `rating_pending` → klant | `/client/shifts/[shiftId]/rate` |

All klant emails resolve recipients via `recipientsForClient(clientId, eventKey)` — never a hard-coded `client.email`.

---

## Edge cases

- **No placement yet**: hub shows "Wacht op planning" + `cancel_request` only. AI explains Chef & Serve is sourcing a chef.
- **Multiple placements on one shift** (e.g. one rejected, one proposed): `getClientShiftLabel` is driven by the most-progressed placement; the hub still renders a card per placement. AI describes the live one and mentions a prior rejection only as context.
- **Hours row exists but chef hasn't submitted** (`draft`): label is "Uren nog niet ingediend", no klant action. AI: "de chef vult de uren in na de shift".
- **Shift cancelled with no placement**: label "Geannuleerd", `allowedActions=[]`. AI offers to draft a new request (global action), not a change-request on a dead shift.
- **Open change-request already exists**: hub renders the existing request inline (status + filed-at) instead of a fresh form. AI surfaces it rather than offering to file a duplicate.
- **Stale read**: a row may move while the LLM is thinking. AI refetches before asserting "live" status.

---

## Example user commands

### Klant (own)

- "Wat is de status van mijn vrijdag-shift?" → AI returns `humanStatus` + `nextStep` + cites shift id.
- "Wat gebeurt er nu met de chef die jullie voorstelden?" → AI explains "Chef voorgesteld — Chef & Serve bevestigt de match", offers to draft a comment.
- "Kan ik deze shift nog wijzigen?" → AI checks `allowedActions`; if `change_request` present, offers to draft + deep-links the modal.
- "Akkoord met de uren" → AI refuses to click; deep-links `/client/shifts/[id]/hours` where the klant presses "Akkoord".

### Admin

- "Welke shifts wachten op de klant?" → AI lists shifts whose label is "Uren wachten op jouw akkoord", grouped by klant.

---

## Expected AI answer style

- **Plain Dutch.** Never a raw enum.
- **Always end with the next step.** "Volgende stap: jij geeft akkoord op de uren. [Open urenscherm]".
- **Cite the shift.** "Bron: shift #abc-123."
- **Route, don't act.** Provide the deep-link to the correct sub-page/modal; let the klant click.
- **One shift at a time.** When listing, group by `nextStep` / next-actor first.
- **Respect the no-veto rule.** Describe a proposed chef neutrally; never imply the klant approves or rejects the chef.
