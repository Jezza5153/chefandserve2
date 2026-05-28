# Workflow: Recurring shift template change (admin-owned, klant requests)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2** (klant-side) + Part 3.3 (worker). Ships with PR-KLANT-4 (`migration 0023_shift_templates.sql`).

## Purpose

Hotels with a standing pattern ("a sous-chef every Friday 17:00–01:00") shouldn't re-file a request each week. A `shift_templates` row encodes the weekly pattern; `workers/generate-recurring-shifts.ts` generates real `shifts` ahead of time. **Templates are admin-owned**: the admin creates and edits them (with a preview-before-save step); the klant *views* the pattern as a friendly weekly agreement and can *request* a change. Exceptions (`shift_template_exceptions`) handle skip-dates (Christmas week, renovation pause, a one-off).

The AI's job: explain the weekly pattern in plain Dutch, list the next generated dates, and draft a change request for the klant. It never edits a template and never changes a rate.

---

## Actors

- **Admin (`owner`+)** — creates/edits templates and exceptions via `/admin/business/templates/[id]`; confirms the preview-before-save panel.
- **Klant** — views `/client/templates`; files a change request via "Wijziging aanvragen".
- **System worker** — `workers/generate-recurring-shifts.ts` (daily cron) materialises shifts.

---

## Source tables

- `shift_templates` — `client_id`, `role_needed` (vakniveau), `segment`, `day_of_week` (0–6), `starts_at_time`, `ends_at_time`, **`ends_next_day boolean`** (overnight support), `headcount`, `chef_rate_cents`, `client_rate_cents`, `active`, `generate_horizon_days`, `last_generated_at`.
- `shift_template_exceptions` — `template_id`, `date`, `reason` (skip dates; unique per `(template_id, date)`).
- `shifts` — generated rows, linked back via `source_template_id` + `source_template_date` (unique together → idempotency). The worker copies `clients.shiftAddress → shifts.location` and `clients.city → shifts.city` at generation (location snapshot rule).
- `client_change_requests` — a klant template-change request is recorded here with `field='template:<templateId>'`.
- `audit_log`.

---

## Human status labels

Templates use `active` (boolean), shown to the klant as a friendly status:

| Backend | Dutch label (klant view) |
|---|---|
| `active=true` | "Actief — elke {dag} {tijd}" |
| `active=false` | "Gepauzeerd — geen nieuwe shifts" |

Overnight display rule: whenever `ends_next_day` is true (or `ends_at_time <= starts_at_time`), the time range renders with `(+1 dag)` and the duration is computed across midnight in `Europe/Amsterdam`.

---

## The weekly pattern (how the worker reads a template)

`workers/generate-recurring-shifts.ts`, daily:

1. Read active templates not generated in the last ~6h.
2. Compute target dates in `[today, today + generate_horizon_days]` matching `day_of_week`.
3. Subtract any `shift_template_exceptions.date` for that template.
4. Compute `startsAt`/`endsAt` in `Europe/Amsterdam`; **if `ends_next_day` (or end ≤ start), add one calendar day to `endsAt`**, then convert to UTC. DST-aware, not naive arithmetic.
5. Copy `clients.shiftAddress → shifts.location`, `clients.city → shifts.city` (snapshot).
6. `INSERT INTO shifts(...) ON CONFLICT (source_template_id, source_template_date) DO NOTHING`.
7. Update `last_generated_at` + audit per-template row count.

**Rule:** already-generated shifts are independent — editing a template does NOT rewrite existing shifts.

---

## Allowed transitions

Template + exception mutations are **admin-only**:

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (none) | template `active=true` | admin | preview-before-save confirmed | admin create |
| template edit | new values | admin | preview-before-save confirmed | admin edit |
| `active=true` | `active=false` | admin | confirmation ("bestaande shifts blijven staan") | admin toggle |
| (none) | exception row | admin | date not already excepted | admin add exception |

Klant-side, the only operation is filing a request:

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `client_change_requests` `pending` | klant (own) | template belongs to caller's client; `field='template:<id>'` | `requestClientChange('template:<id>', proposedValue, reason)` |

---

## AI can read

Through `template.read`, `template.explain_pattern` (see [`../tool-contracts/client-template-tools.md`](../tool-contracts/client-template-tools.md)) + the proposed `ai_recurring_template_summary_view`:

- The template's human pattern ("elke vrijdag, sous-chef, 17:00–01:00 (+1 dag), 1 chef").
- Next generated dates within the horizon, minus exceptions.
- The list of exceptions (skip dates + reason).
- Any pending klant change request for the template.
- Rate fields (`chef_rate_cents`/`client_rate_cents`) only to **admin**; the klant view shows "Tariefafspraak: via Chef & Serve", never the numbers.

Cites `shift_templates.id`.

---

## AI can draft

- A plain-Dutch explanation of the weekly pattern + the next dates.
- A klant change request ("graag voortaan om 18:00 in plaats van 17:00, vanaf 1 juli") → drafts the `field='template:<id>'` request body + reason.
- For admin: a draft exception reason, or a summary of what a proposed edit would generate.

---

## AI can execute only after explicit human confirmation

- **`template.draft_change_request`** is draft-only.
- **Filing the klant request** — klant clicks "Wijziging aanvragen" → "Verzoek versturen". Audit: `ai.client_request.submit_template_change` (a `client_change_requests` row with `field='template:...'`).

There is **no AI tool to edit a template or change a rate** — those are admin-only UI actions behind the preview-before-save panel.

---

## AI must never do

- **Edit a `shift_templates` row** (day, time, headcount, role, `active`, exceptions). Templates are admin-owned; the AI drafts a *request*. (Hard rule — `ai-safety-rules.md`.)
- **Change `chef_rate_cents` / `client_rate_cents`**, or even reveal them to the klant. Rate is a Chef & Serve term.
- **Add/remove a `shift_template_exceptions` row** for the klant.
- **Claim a template edit rewrote existing shifts.** It doesn't — only future generations change.
- **Generate or cancel shifts directly.** That is the worker's job (audited per-template).
- **Mis-handle overnight**: when explaining duration, the AI must respect `ends_next_day` / end ≤ start and say "(+1 dag)", not compute a negative span.

---

## Audit keys

System:

- `shift_templates.created` / `shift_templates.updated` / `shift_templates.deactivated`
- `shift_template_exceptions.created` / `.deleted`
- `recurring_shifts.generated` (per-template, with count, by the worker)
- `client.change_requested` (with `field='template:<id>'`)

AI-assisted:

- `ai.client_request.submit_template_change` (paired with `client.change_requested`)

---

## Notifications

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Klant requests template change | `client_change_request` to admin recipients | `ClientChangeRequestAdminEmail` | admin routing |
| Admin decides | `client_change_decided` to klant | `ClientChangeRequestOutcomeKlantEmail` | `recipientsForClient(clientId, 'generic')` |

Generated shifts then ride the normal proposal/hours notification flow per shift.

---

## Edge cases

- **Exception added after a shift was already generated for that date**: the existing shift stays; the admin manually cancels if needed. The template detail UI shows next-dates AND exceptions side-by-side so the gap is visible. AI explains the already-generated shift is independent.
- **Overnight shift (17:00–01:00)**: `ends_next_day=true`; the worker computes `endsAt` on the next day in Amsterdam time. AI displays "17:00 – 01:00 (+1 dag)".
- **`active=false` toggled**: no new shifts generate; existing ones remain. AI: "geen nieuwe shifts, bestaande blijven staan".
- **Rate change requested by klant**: goes through `client_change_requests` (`field='template:<id>'`); on approval, FUTURE generations use the new rate. AI never quotes or sets the rate.
- **DST boundary**: the worker uses a TZ-aware lib; the AI should not attempt its own UTC math when explaining times — it reports the stored/displayed local time.
- **Duplicate active template** for same `(client, day_of_week, starts_at_time, role)`: blocked by the unique index; AI surfaces the conflict to admin, doesn't create.

---

## Example user commands

### Klant (own)

- "Hoe ziet mijn vaste vrijdag-afspraak eruit?" → AI explains the pattern + next 4 dates (minus exceptions).
- "Kan de vaste shift voortaan om 18:00 beginnen?" → AI drafts a `template:<id>` change request + reason, asks the klant to click "Verzoek versturen".
- "Wat kost die vaste shift?" → AI: "De tariefafspraak loopt via Chef & Serve" (never the cents).

### Admin

- "Wat genereert deze template de komende maand?" → AI lists the dates the worker would create (respecting exceptions + `ends_next_day`).
- "Voeg 26 december toe als uitzondering." → AI drafts the exception reason; admin adds it.

---

## Expected AI answer style

- **Friendly weekly framing** for the klant ("elke vrijdag"), not admin data.
- **Always respect `ends_next_day`** in time/duration explanations ("(+1 dag)").
- **Never expose or set rates** to the klant.
- **Draft requests, never edit templates.**
- **Cite**: "Bron: template `st #abc-123`."
