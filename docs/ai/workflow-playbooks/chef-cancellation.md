# Workflow: Chef cancellation (severity tiers)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.2**. Ships with PR-CHEF-5.

## Purpose

A chef accepted or got a confirmed placement, but now they can't work. The system reflects this immediately, notifies klant + admin, and the severity of the cancellation determines whether a phone call is also needed.

The mechanism is: same DB transition, different downstream UX based on **hours-until-shift**. Three tiers per `src/lib/cancellation-severity.ts` (thresholds subject to tuning after 1 month real use — see MEMORY.md Open question #6):

- **Tier 1 — Early (>48h before shift):** standard email + in-app notification.
- **Tier 2 — Late (24-48h before shift):** email + in-app + admin nudge.
- **Tier 3 — Same-day / very late (<24h):** all of the above PLUS the cancel UI shows a "[Bel Maarten] tel: link" so the chef calls Maarten directly. Admin gets a higher-priority notification.

---

## Actors

- **Chef** — initiates cancellation.
- **System** — computes severity, fires emails + notifications + contact prompts.
- **Admin (`owner`+)** — receives the notification, may follow up; logs the contact (`contact_logs`).
- **Klant** — receives the cancellation email.

---

## Source tables

- `placements` — status transitions to `cancelled`, `cancelledAt`, `cancelledReason`.
- `shifts` — for `startsAt` (severity computation).
- `contact_logs` — admin-logged phone calls.
- `integration_outbox` — `placement.cancelled_by_chef`.
- `notifications`, `email_messages`, `email_events`.

---

## Human status labels

Same as the shift-proposal flow:

- Backend `cancelled` → Dutch: "Geannuleerd door chef"

Plus the tier label, surfaced in admin UI:

| Severity | Dutch label | UI treatment |
|---|---|---|
| Tier 1 | "Vroeg afgezegd (>48u)" | Normal |
| Tier 2 | "Laat afgezegd (24-48u)" | Yellow border |
| Tier 3 | "Last-minute afgezegd (<24u)" | Red border + [Bel Maarten] prompt |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| `accepted`, `confirmed` | `cancelled` | chef (own) | chef owns the placement; placement not in past (`shift.endsAt > now()`); reason captured | `cancel(reason)` |

Atomic: `UPDATE placements SET status='cancelled', cancelledAt=now(), cancelledReason=? WHERE id=? AND status IN ('accepted','confirmed')`. If 0 rows update → stale.

After cancellation, **no automatic chef re-propose**. Maarten manually finds a replacement (with AI help via `shifts.find_candidates`).

---

## AI can read

Through `shifts.read` + tier inference:

- The list of placements where the chef has open `accepted` or `confirmed` status.
- For a specific placement: computed severity tier given current time.
- For admin: list of recently cancelled placements grouped by tier.
- `contact_logs` rows for a placement (admin only).

---

## AI can draft

- **Chef-side draft cancel-reason text.** When a chef opens the cancel flow and types "I'm sick", the AI may suggest a slightly more complete message to send to the klant ("Ik ben helaas ziek en kan op 12 juni niet werken. Mijn excuses voor het late bericht.") — chef still presses send.
- **Admin-side draft "I called Daniel, here's what we agreed" log.** AI may transcribe a free-text dictation into a `contact_logs` row template; admin clicks "Opslaan".
- **Klant-side empathy reply.** Admin may ask "draft een excuses-mail voor Hotel Pulitzer dat Daniel is uitgevallen". AI drafts; admin sends via `notifications.send`.

---

## AI can execute only after explicit human confirmation

- **`shifts.cancel` (chef side)** — NO. The AI may prepare the form but the chef themselves clicks "Annuleer dienst" on their own page. This is one of the chef-impersonation safeguards.
- **`shifts.cancel` (admin side, on chef's behalf)** — admin may cancel ON BEHALF of a chef who phones in. AI can prepare the row + reason; admin clicks "Annuleer namens chef". Audit: `ai.shifts.cancel_on_behalf` + `placements.cancelled_by_admin_on_behalf`.
- **`contact_logs.create`** — admin types or dictates the call summary; AI helps format; admin clicks "Opslaan". Audit: `ai.contact_logs.create` + `contact_log.created`.

---

## AI must never do

- **Cancel autonomously** based on guess (e.g. chef messaged "voel me niet lekker" in WhatsApp). Even if WhatsApp tracking shipped, a cancel is a deliberate state mutation requiring chef confirmation.
- **Hide a cancellation from the klant.** Email + in-app notification are mandatory.
- **Downgrade a Tier 3 severity** to make the chef look better. Severity is computed from data, not editorial.
- **Skip the contact prompt on Tier 3.** The "[Bel Maarten]" button must appear; the AI cannot suppress it.
- **Fill `contact_logs` retroactively** to fabricate that someone was called. Admin types it themselves.

---

## Audit keys

System:

- `placements.chef_cancelled` (with tier in payload)
- `placements.cancelled_by_admin_on_behalf` (when admin cancels in chef's name)
- `contact_log.created`

AI-assisted:

- `ai.shifts.cancel_on_behalf`
- `ai.contact_logs.create`

---

## Notifications

| Event | In-app type | Email template |
|---|---|---|
| Chef cancels | `shift_cancelled_by_chef` to klant + admin recipients | `ShiftCancelledByChefClientEmail` + `ShiftCancelledByChefAdminEmail` |

Routing event key: `placement_chef_cancelled` (per `WORKFLOW.md` Part 4.4 planned).

Tier 3 adds:
- In-app notification flagged `priority='urgent'`.
- Email subject prefixed with "[Last-minute]".
- Admin's notification body contains a one-click `tel:` link to Maarten if the chef hasn't called yet.

Outbox:

- `placement.cancelled_by_chef` → calendar provider + alerting.

---

## Edge cases

- **Chef cancels Tier 3 then no longer answers**: admin uses the `[Bel Maarten]` prompt to reach the chef; if unreachable, admin escalates to klant directly. AI may draft the klant email.
- **Multiple chefs at same shift**: each cancellation is independent. The klant gets one email per cancel. AI may collapse to a single "summary" email IF admin chooses; default is per-chef.
- **Chef cancels AND shift was already past `endsAt`**: rejected by the precondition check. Use `no_show` flow instead.
- **System clock skew**: tier boundary close to midnight. Always compute server-side using `shift.startsAt`, not chef's local time.
- **Repeat-cancellations from the same chef**: pattern detection feature for PR-CHEF-FUT. AI may surface "Daniel heeft 3× in 30 dagen geannuleerd" as a flag, but never auto-blocks. Maarten decides.
- **Chef wants to "uncancel"**: not supported. A cancelled placement stays cancelled. If a chef wants back in, Maarten creates a new placement.

---

## Example user commands

### Chef

- "Ik ben ziek, kan 8 juni niet werken." → AI opens the cancel flow for 8 juni's placement, suggests reason text, chef presses [Annuleer].
- "Heb ik recent geannuleerd?" → AI lists own cancelled placements (last 90d), with tier and reason.

### Admin

- "Hoeveel Tier 3 cancellaties dit kwartaal?" → AI returns count + chef breakdown.
- "Daniel heeft net gebeld dat hij niet kan 8 juni — annuleer namens hem en log het gesprek" → AI prepares the cancel + contact_log; admin confirms both.
- "Welke shifts hebben nog open slots na annuleringen?" → AI lists shifts where `confirmed_count < headcount` due to recent cancels.

### Klant

- "Wat is er gebeurd met mijn 8 juni dienst?" → AI: "Daniel heeft op 7 juni om 14:23 geannuleerd. Reden: ziek. Maarten zoekt vervanging. Bron: `placement #xyz`."

---

## Expected AI answer style

- Be empathetic on the chef side ("vervelend dat je ziek bent"), neutral on admin/klant.
- Always state the tier explicitly: "Dit is een Tier 3 annulering (4 uur voor de dienst)."
- For Tier 3, always show the [Bel Maarten] prompt.
- When summarizing for admin, sort by severity (T3 first) and time-to-shift.
- Never speculate on the reason beyond what the chef typed.
