# Workflow: Client hours signing (sub-flow of hours trust chain)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.1** — the middle stage of the trust chain. Ships with PR-CHEF-1.

## Purpose

A chef submitted hours; now the klant must sign or reject. This is the second irrevocable consent step in the hours trust chain. The whole point of the chain only works if klant signing is friction-free and unambiguous.

This playbook focuses on the klant-side experience. The chef-side `submit` is documented in [`hours-trust-chain.md`](./hours-trust-chain.md).

---

## Actors

- **Klant** — signs or rejects.
- **System worker** — `workers/hours-reminders.ts` may nudge after 5 days unsigned.
- **Admin** — may force-approve after klant timeout (separate path, distinct audit key).

---

## Source tables

- `shift_hours` — the row being signed.
- `placements`, `shifts`, `clients` — context for the receipt page.
- `notifications`, `email_messages` — fired on sign/reject.
- `integration_outbox` — `hours.client_signed`.
- `audit_log`.

---

## Human status labels

Klant-facing only the relevant subset:

| Backend status | Dutch label (klant view) |
|---|---|
| `submitted` | "Wacht op jouw goedkeuring" |
| `client_signed` | "Door jou goedgekeurd" |
| `client_rejected` | "Door jou afgewezen" |
| `admin_approved` | "Definitief goedgekeurd" |
| `exported` | "Verwerkt voor uitbetaling" |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| `submitted` | `client_signed` | klant (own) | klant owns the shift's client | server action `signHours` |
| `submitted` | `client_rejected` | klant (own) | reason field required | server action `rejectHours` (client side) |
| `client_rejected` | (back to chef as `submitted` after resubmit) | chef | chef owns + provides updated hours | `submitHours` (re-submit) |

Atomicity: `UPDATE shift_hours SET status=? WHERE id=? AND status='submitted'`. If 0 rows update, the row already moved (e.g. chef rescinded, admin force-approved, klant accidentally double-clicked).

---

## Klant-side UI (receipt-style page at `/client/shifts/[shiftId]/hours`)

The page shows the shift in receipt format:

- Chef name + vakniveau.
- Date + scheduled time (from `shift`).
- Worked time (from `shift_hours.startedAt`, `endedAt`, `breakMinutes`).
- Schedule deviation flag if `|worked - scheduled| > 15 min`.
- Computed amount (client portion = `clientRateCents × workedHours`).
- Chef's notes if any.
- Two buttons: [Akkoord] (primary) and [Niet akkoord — geef reden] (secondary).

---

## AI can read

Through `hours.read`, `hours.list_queue`, `hours.summarize`:

- The klant's queue of `submitted` rows.
- Per row: chef name, date, worked time, scheduled time, amount, deviation flag.
- Historical pattern: how many rows the klant has signed vs. rejected.
- Time-since-submission (overdue marker after 3 days; admin alert after 5).

---

## AI can draft

- Klant-side reminder *to themselves*: "je hebt 3 rijen openstaan, hier zijn ze". This is purely informational.
- Klant-side rejection reason text: if klant says "Daniel kwam te laat aan", AI may rephrase to a complete reason and ask "wil je dit als reden indienen?". Klant clicks "Wijs af met deze reden".
- Admin: nudge-to-klant email draft when overdue.

---

## AI can execute only after explicit human confirmation

- **`hours.sign` (client side)** — **NO autonomous, NO assisted on klant's behalf.** Even if the klant says "akkoord" in chat, the AI redirects to the page where the klant clicks the explicit [Akkoord] button. This is the strict impersonation safeguard.
- **`hours.reject_by_client`** — same rule. The button is on the page, not in chat.
- For ADMIN nudging klant (a different flow), see [`hours-trust-chain.md`](./hours-trust-chain.md) — admin may draft + send reminders via `notifications.send`.

---

## AI must never do

- **Click [Akkoord] for the klant.** This is the load-bearing consent step; the AI never bypasses it. The whole trust chain depends on this being a deliberate human act.
- **Auto-reject** based on perceived inconsistency. If the AI sees a deviation flag, it MENTIONS it; the klant decides.
- **Hide the chef's notes.** Whatever the chef wrote (notes field) is part of the receipt.
- **Aggregate sign actions.** Each row is its own consent. No "sign all" button — the klant must click per row. (Future PR may add "sign all without exceptions", but that's a deliberate UI feature with its own audit, not an AI action.)
- **Spam reminders.** A klant gets at most one reminder per row per 2 days, regardless of AI suggestion.

---

## Audit keys

System:

- `shift_hours.client_signed`
- `shift_hours.client_rejected`

AI never directly emits a `client_signed` audit row — only the human-clicked sign generates it. AI's role in this sub-flow is purely read + draft.

If the klant uses the AI to *draft* a rejection reason and then clicks reject on the page, the audit chain is:
- `ai.hours.draft_rejection_text` (AI suggestion, before/after = drafted text)
- `shift_hours.client_rejected` (the actual click — separate row)

---

## Notifications

| Event | In-app type | Email template |
|---|---|---|
| Klant signs | `hours_signed` to chef + `hours_ready_to_approve` to admin recipients | `HoursSignedChefEmail` + `HoursSignedAdminEmail` |
| Klant rejects | `hours_rejected_by_klant` to chef | `HoursRejectedByKlantChefEmail` |
| Klant overdue (5d) | (admin in-app + email cc) | `HoursReminderKlantEmail` |

Outbox:

- `hours.client_signed` → internal (for trust-chain forensics)

---

## Edge cases

- **Klant has 50 rows pending**: pagination + sort by oldest. The AI's `hours.list_queue` returns a digestible grouping by chef.
- **Klant rejects and chef resubmits**: same row id, new submission. The klant sees BOTH timelines on the receipt page (collapsed by default).
- **Klant accidentally clicks [Akkoord]**: no in-flow undo. They contact Maarten; admin uses `voidHours` (admin-only path), then chef re-submits. This is by design — make signing feel weighty.
- **Multiple klant users per company** (future): all see the same queue; first to sign wins (atomic). Audit captures which user signed.
- **Klant has not logged in for 14 days with overdue rows**: cron + admin notification. AI surfaces "Hotel Pulitzer heeft 6 rijen openstaan sinds 12 mei".
- **Schedule deviation flag**: prominent in UI. Klant signing with a deviation is still allowed (within policy) — the AI must NOT hide this; the audit record carries the deviation amount.
- **Rate override flag** (placement's rate != shift's default): klant sees the override + the original; admin must have set this; klant signs the override.

---

## Example user commands

### Klant

- "Welke uren moet ik tekenen?" → AI lists `submitted` rows grouped by chef, sorted by oldest.
- "Akkoord met Sophie 14 juni" → AI: "Open Sophie's rij om akkoord te geven. [Open]". Does NOT sign.
- "Waarom moet ik dit tekenen?" → AI: "Dit is je formele goedkeuring dat de gewerkte uren kloppen. Daarna kan Maarten ze goedkeuren voor uitbetaling. [Lees meer in het privacybeleid]".
- "Sophie kwam te laat, ik wil afwijzen" → AI suggests reason text, klant clicks reject on the row page.

### Admin

- "Welke klanten hebben overdue rijen?" → AI returns grouped list.
- "Stuur Hotel Pulitzer een herinnering" → AI drafts, admin confirms send via `notifications.send`.

---

## Expected AI answer style

- Use receipt vocabulary: "5 uur gewerkt", "€XX,XX te factureren", "akkoord = definitief".
- One row at a time when possible.
- Always show the chef's notes if present.
- Surface deviation: "Sophie heeft 5,5u ingediend, gepland was 5u — afwijking +30 min."
- Never recommend "ja, teken maar" — that's editorial. Recommend "lees de regel, klik dan op de pagina".

---

## What this sub-flow protects against

The whole point of klant-side signing is to lock in the klant's agreement BEFORE we ask Maarten to approve for payroll. Without this consent step, every dispute later ("ik herinner me niet dat Sophie zo lang werkte") would land on Maarten. With this step, the audit shows: klant explicitly clicked Akkoord at 14 juni 18:42 from IP X with UA Y.

The AI's role is to make the click easy and informed, never to make it for them.
