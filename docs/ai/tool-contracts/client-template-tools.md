# Tool contracts: Recurring shift templates

> Tools wrapping [`../workflow-playbooks/recurring-shift-template-change.md`](../workflow-playbooks/recurring-shift-template-change.md). Templates are **admin-owned**; the klant views + requests changes.

---

## Tool: `template.read`

### Purpose
Read a recurring `shift_templates` row + its exceptions + upcoming generated dates.

### Inputs
- templateId: uuid (caller's own client, or any for admin)

### Required role
client (own) · owner | super_admin (any)

### Allowed user kinds
internal · client

### Read scope
`shift_templates`, `shift_template_exceptions`, generated `shifts` (via `source_template_id`), the proposed `ai_recurring_template_summary_view`. **Rate fields (`chef_rate_cents`/`client_rate_cents`) are admin-only**; the klant projection omits them ("Tariefafspraak: via Chef & Serve").

### Write scope
None.

### Preconditions
Caller authed; template belongs to caller's client (or caller is admin).

### Side effects
`ai.tool_invoked` audit `action='template.read'`.

### Dry-run result shape
n/a (read-only).

### Confirmation requirement
`read`.

### Audit events
`ai.template.read`

### Rollback
n/a.

---

## Tool: `template.explain_pattern`

### Purpose
Render the template as a plain-Dutch weekly pattern + the next generated dates (minus exceptions), respecting overnight (`ends_next_day`).

### Inputs
- templateId: uuid
- horizonDays: int (optional; default the template's `generate_horizon_days`)

### Required role
client (own) · owner | super_admin (any)

### Allowed user kinds
internal · client

### Read scope
Same as `template.read`; computes target dates in `Europe/Amsterdam`, applies `ends_next_day` / end ≤ start to add a day, subtracts `shift_template_exceptions`.

### Write scope
None.

### Result shape
```jsonc
{
  "humanPattern": "Elke vrijdag · Sous-chef · 17:00 – 01:00 (+1 dag) · 1 chef",
  "nextDates": ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28"],
  "exceptions": [{ "date": "2025-12-26", "reason": "Kerstvakantie" }],
  "endsNextDay": true,
  "rateVisibleToCaller": false
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.template.explain_pattern`

### Rollback
n/a.

---

## Tool: `template.draft_change_request`

### Purpose
Prepare a klant change request against a template. Does not submit, does not edit the template.

### Inputs
- templateId: uuid (caller's own)
- proposedValue: jsonb (e.g. `{ "starts_at_time": "18:00" }` or `{ "headcount": 2 }`)
- reasonHint: text

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`shift_templates` (own client). For drafting context only.

### Write scope
None (draft only). On submit (separate confirm step) it writes a `client_change_requests` row with `field='template:<templateId>'` — handled by `client.submit_profile_change`-style flow / the requests surface.

### Dry-run result shape
```jsonc
{ "field": "template:abc-123", "proposedValue": { "starts_at_time": "18:00" }, "draftReason": "...", "draftId": "uuid" }
```

### Confirmation requirement
`draft`. Filing requires the klant to click "Verzoek versturen" (assisted); audited `ai.client_request.submit_template_change` + `client.change_requested`.

### Audit events
`ai.template.draft_change_request`

### Rollback
Admin resolves the resulting `client_change_requests` row.

---

## Forbidden / boundaries

- **`template.edit` — DOES NOT EXIST for the AI.** Templates are admin-owned and edited only via the admin UI behind the preview-before-save panel. The AI drafts a *request*; it never mutates `shift_templates` (day, time, `headcount`, `role_needed`, `active`, `ends_next_day`) or `shift_template_exceptions`. (Hard rule — `ai-safety-rules.md`.)
- **`template.change_rate` — FORBIDDEN.** The AI never changes `chef_rate_cents`/`client_rate_cents`, and never reveals them to the klant. Rate is a Chef & Serve term; a klant rate-change goes through the request flow and, on admin approval, applies to FUTURE generations only.
- **AI never generates or cancels shifts** — that is `workers/generate-recurring-shifts.ts` (per-template audited). Editing a template never rewrites already-generated shifts.
- **Overnight correctness**: when explaining duration, the AI must honour `ends_next_day` / end ≤ start ("(+1 dag)") and never compute a negative or wrong span.
