# Workflow: Shift proposal → chef accept → admin confirm

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 1.6**. Currently live (V0). Gap: chef does not yet get a confirmation email (PR-CHEF-5 closes this).

## Purpose

Maarten matches a chef to a shift. Both sides need to opt in:

1. Maarten proposes (a placement row appears in `proposed` state).
2. Chef accepts or rejects (`accepted` / `rejected`).
3. Maarten confirms (`confirmed`), klant gets notified.

The chain is two-sided consent. The chef commits to working; Maarten commits the chef to the klant. After `confirmed`, hours chain begins (after the shift happens).

---

## Actors

- **Admin (`owner`+)** — proposes the placement, later confirms.
- **Chef** — accepts or rejects the proposal.
- **System** — fires emails + audit + outbox.

---

## Source tables

- `shifts` — the client request.
- `placements` — the (chef, shift) link.
- `audit_log` — every transition.
- `integration_outbox` — `shift.confirmed`, `placement.cancelled_by_chef` (future).
- (PR-CHEF-0+) `notifications`, `email_messages`, `email_events`.

---

## Human status labels

Per `src/lib/hours-labels.ts` (extended by PR-CHEF-1). Backend → Dutch:

| Backend status | Dutch label |
|---|---|
| `proposed` | "Voorstel verstuurd, wacht op chef" |
| `accepted` | "Chef heeft geaccepteerd, wacht op bevestiging" |
| `rejected` | "Chef heeft afgewezen" |
| `confirmed` | "Bevestigd" |
| `cancelled` | "Geannuleerd" |
| `no_show` | "Niet komen opdagen" |
| `completed` | "Afgerond" |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `proposed` | admin (`owner`+) | shift exists; chef in `active` status; no existing placement for (chef, shift) | `proposePlacement` |
| `proposed` | `accepted` | chef (own) | chef owns the placement | `respond({decision:'accept'})` |
| `proposed` | `rejected` | chef (own) | chef owns the placement; optional reason | `respond({decision:'reject', reason})` |
| `accepted` | `confirmed` | admin (`owner`+) | placement is `accepted`; shift can absorb (headcount > confirmed_count) | `setPlacementStatus('confirmed')` |
| `accepted`, `confirmed` | `cancelled` | chef (own, with severity) | per [chef-cancellation.md](./chef-cancellation.md) | `cancel(reason)` |
| `confirmed` | `cancelled` | admin (`owner`+) | reason required | `setPlacementStatus('cancelled')` |
| `confirmed` | `no_show` | admin (`owner`+) | after `shift.endsAt`; chef didn't appear | `setPlacementStatus('no_show')` |
| `confirmed` | `completed` | system worker (`complete-placements`) | `shift.endsAt < now() - 1h` | INSERT `shift_hours` draft + UPDATE placement |

---

## AI can read

Through `shifts.read`, `shifts.find_candidates` (admin only):

- Open shifts (status `request` or `open`).
- For a given shift: who has been proposed, who accepted, who's still pending.
- For a given chef: own placement queue with countdown to response deadline.
- Historical placement outcomes (for ranking).
- Similar past shifts (RAG semantic match, Phase 9+).

The AI may answer "voor wie kan ik 28 juni Lute proposen?" by returning a ranked list with reasoning (vakniveau match, availability, distance, history).

---

## AI can draft

- Admin: shortlist of candidates with reasoning. The AI ranks; Maarten chooses.
- Admin: cancel-message to klant when a chef cancels (a Tier 3 cancel needs a klant call — AI may draft the message but not send).
- Chef: nudge to respond to an open proposal ("Je hebt een voorstel openstaan voor 12 juni, deadline donderdag 18:00").

---

## AI can execute only after explicit human confirmation

- **`shifts.propose_placement`** — admin reviews candidate, clicks "Voorstel versturen". The AI prepares the row + email body; admin confirms. Audit: `ai.shifts.propose_placement`. The actual mutation is `placements.proposed`.
- **`shifts.confirm_placement`** — admin clicks "Bevestigen" on an `accepted` row. Audit: `ai.shifts.confirm_placement`.
- **`shifts.cancel`** (admin side) — admin clicks "Annuleer dienst" with reason. Audit: `ai.shifts.cancel`.

Chef-side responses (`respond accept/reject`) — the AI surfaces the proposal and opens the response page. The chef clicks "Accepteer" or "Wijs af" themselves. NOT executable by AI on the chef's behalf — that's impersonation.

---

## AI must never do

- **Auto-confirm a placement** even after chef accept. Maarten needs to look at the klant-side composition (e.g. brigade balance) before confirming.
- **Cancel a confirmed placement autonomously.** Even with admin confirmation in chat, the cancel button is the explicit action.
- **Accept a proposal on the chef's behalf** — impersonation.
- **Send proposal emails to chefs outside the candidate set** without admin curation.
- **Skip the availability check** when proposing — `chef_availability` rows are an absolute filter.
- **Override a chef's rejection** (e.g. "propose them anyway"). A rejection ends the placement row's life; a new row is required for a re-propose, with audit trail.

---

## Audit keys

System:

- `placements.proposed`
- `placements.chef_accepted`
- `placements.chef_rejected`
- `placements.confirmed`
- `placements.chef_cancelled` (see `chef-cancellation.md`)
- `placements.cancelled` (admin-side)
- `placements.no_show`
- `placements.completed_auto`

AI-assisted (paired):

- `ai.shifts.propose_placement`
- `ai.shifts.confirm_placement`
- `ai.shifts.cancel`

---

## Notifications

Per `WORKFLOW.md` Part 4.1 + 4.2:

| Event | In-app type | Email template |
|---|---|---|
| Admin proposes | `shift_proposed` to chef | `ShiftProposedEmail` |
| Chef accepts | (none today; admin notifies via UI) | (none today; PR-CHEF-5 may add) |
| Admin confirms | `shift_confirmed` to chef + (planned) | `ShiftConfirmedClientEmail` to klant + (PR-CHEF-5) `ShiftConfirmedChefEmail` to chef |
| Chef cancels | `shift_cancelled_by_chef` to klant + admin | `ShiftCancelledByChefClientEmail` + `ShiftCancelledByChefAdminEmail` |

Outbox:

- `shift.confirmed` → calendar provider (future ICS subscribers)
- `placement.cancelled_by_chef` → calendar + alerting

---

## Edge cases

- **Headcount > 1**: multiple placements per shift. Maarten can propose simultaneously to multiple chefs; first to accept wins (atomic). The AI should highlight which slots remain.
- **Chef accepts but capacity is filled**: race condition. The atomic `UPDATE … WHERE shift.confirmed_count < shift.headcount` rejects. The chef sees "deze dienst is helaas net vol".
- **Chef accepts then becomes unavailable** (e.g. illness): chef triggers `chef-cancellation.md` flow.
- **Klant cancels the shift** while placements exist: cascade cancel all placements (via separate admin action), notify all affected chefs.
- **Proposal not responded to**: no auto-expiry today. Maarten manually re-proposes or cancels. PR-CHEF-5+ may add proposal expiry; AI draft a reminder to chef in the meantime.
- **Re-propose to same chef after rejection**: requires Maarten to cancel/void the rejected row and create a new one. Audit trail keeps both visible.

---

## Example user commands

### Admin

- "Wie kan ik voorstellen voor 28 juni Lute, sous chef?" → AI returns ranked list (see ai-product-vision.md).
- "Stuur Daniel een voorstel voor 28 juni" → AI prepares the proposal + email preview; admin confirms.
- "Welke shifts staan open?" → AI lists `request` + `open` shifts grouped by date.

### Chef

- "Welke voorstellen heb ik openstaan?" → AI lists `proposed` placements with response deadline.
- "Wat is de werklocatie voor 12 juni Pulitzer?" → AI reads `shifts.location` (linked to caller's placement).

### Klant

- "Wie komt 12 juni werken?" → AI lists `confirmed` chefs for that shift (name + city + vakniveau only; never email/phone).

---

## Expected AI answer style

- Cite the placement: "Voorstel `placement #xyz`, voorgesteld op 6 juni."
- For chef list, return name + match-reason in one line: "Daniel — 96% match (sous chef · Amsterdam · 4× eerder bij Lute · ⭐4.7)."
- Always include the deadline: "Reageer voor donderdag 18:00."
- For the klant: short, polite, never names unconfirmed proposals.
