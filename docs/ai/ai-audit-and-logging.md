# AI Audit + Logging

> Every AI call leaves a trace. This doc defines the event taxonomy, the payload schema, the retention policy, and the forensic queries the audit must answer.

The principle: at any moment, Maarten (or Jezza, or a future bookkeeper) must be able to answer "what did the AI do for Lisa today?" with one SQL query. The audit is the answer.

---

## Event naming

All AI-emitted audit rows use the `ai.` namespace.

### Format

```
ai.<surface>.<action>
```

- `<surface>` matches a tool-contract namespace (e.g. `hours`, `shifts`, `notifications`, `profile`, `payroll`, `documents`, `privacy`, `consent`, `integrations`, `backup`).
- `<action>` matches the action name from the tool contract (e.g. `approve`, `draft_reminder`, `bulk_approve`).

### The pairing pattern

For every Mode 3 (assisted execute) action, the AI emits TWO rows:

1. **The AI's suggestion + confirm**: `ai.<surface>.<action>` — payload includes the inputs the AI suggested and what the user confirmed.
2. **The underlying business event**: `<resource>.<action>` from `WORKFLOW.md` Part 6 — payload is the actual state change.

Example (admin approves hours via AI):

```
audit_log:
  row 1: user_id=lisa.id, action='ai.hours.approve', resource='shift_hours', resource_id='abc',
         before={status:'client_signed'}, after={status:'admin_approved', via:'ai_assisted', confirmedAt:'...'}
  row 2: user_id=lisa.id, action='shift_hours.admin_approved', resource='shift_hours', resource_id='abc',
         before={status:'client_signed'}, after={status:'admin_approved', adminApprovedAt:'...', adminApprovedBy:'lisa.id'}
```

This lets us:
- Count AI-assisted approvals vs. direct: `WHERE action LIKE 'ai.hours.approve'`.
- Audit any business event regardless of channel: `WHERE action = 'shift_hours.admin_approved'`.
- Trace any AI-suggested action that got executed (or blocked).

For Mode 1 (read) and Mode 2 (draft) actions, only the `ai.<surface>.<action>` row is emitted (no underlying business event).

---

## The full event catalog

### Read events (Mode 1)

| Event | Surface | When |
|---|---|---|
| `ai.hours.list_queue` | hours | AI lists caller's queue |
| `ai.hours.read` | hours | AI reads single row |
| `ai.hours.summarize` | hours | AI summarises row |
| `ai.shifts.read` | shifts | AI reads single shift |
| `ai.shifts.find_candidates` | shifts | AI returns ranked candidates |
| `ai.shifts.read_history` | shifts | AI reads placement history |
| `ai.notifications.list_unread` | notifications | AI lists unread |
| `ai.email.read_status` | email | AI checks delivery |
| `ai.profile.read` | profile | AI reads profile |
| `ai.profile.list_change_requests` | profile | AI lists change requests |
| `ai.integrations.health` | integrations | AI reads outbox/run health |
| `ai.integrations.read_outbox_row` | integrations | AI inspects a row |
| `ai.payroll.read_batch` | payroll | AI reads a batch |
| `ai.documents.read_metadata` | documents | AI lists documents |
| `ai.consent.list_status` | consent | AI reads consent |
| `ai.privacy.list_requests` | privacy | AI lists requests |
| `ai.audit.search` | audit | AI searches audit log |
| `ai.errors.search` | errors | AI searches error log |

### Draft events (Mode 2)

| Event | Surface | When |
|---|---|---|
| `ai.hours.draft_reminder` | hours | AI prepares a reminder |
| `ai.notifications.draft_message` | notifications | AI drafts a message |
| `ai.notifications.draft_admin_digest` | notifications | AI drafts a digest |
| `ai.profile.draft_change_request` | profile | AI prepares a request |
| `ai.privacy.draft_response` | privacy | super_admin draft helper |
| `ai.privacy.draft_erasure_plan` | privacy | super_admin draft helper |

### Assisted execute events (Mode 3)

| AI event | Business event (paired) |
|---|---|
| `ai.hours.approve` | `shift_hours.admin_approved` |
| `ai.hours.reject_by_admin` | `shift_hours.admin_rejected` |
| `ai.hours.bulk_approve` | `shift_hours.admin_approved` (per row) |
| `ai.hours.create_correction` | `shift_hour_corrections.created` |
| `ai.hours.approve_correction` | `shift_hour_corrections.approved` |
| `ai.hours.send_reminder` | `notification.created` + `email.message_recorded` |
| `ai.hours.draft_submission` | `shift_hours.submit` (chef-clicked) |
| `ai.hours.draft_sign` | `shift_hours.client_signed` (klant-clicked) |
| `ai.shifts.propose_placement` | `placements.proposed` |
| `ai.shifts.confirm_placement` | `placements.confirmed` |
| `ai.shifts.cancel` | `placements.cancelled` |
| `ai.shifts.cancel_on_behalf` | `placements.cancelled_by_admin_on_behalf` |
| `ai.shifts.draft_cancel` | `placements.chef_cancelled` (chef-clicked) |
| `ai.shifts.manual_add_hours` | `shift_hours.admin_created (manual)` |
| `ai.notifications.send` | `notification.created` + `email.message_recorded` |
| `ai.profile.submit_change_request` | `chef.profile_change_requested` (or `client.*`) |
| `ai.profile.approve_change_request` | `chef.profile_change_approved` + `chef.profile_updated` |
| `ai.profile.reject_change_request` | `chef.profile_change_rejected` |
| `ai.profile.withdraw_change_request` | `chef.profile_change_withdrawn` |
| `ai.profile.update_direct_field` | `chef.profile_updated` |
| `ai.integrations.retry_outbox` | `integration.outbox_retried` |
| `ai.payroll.draft_batch` | `payroll_batches.created` |
| `ai.payroll.export_batch` | `payroll_batches.exported` + `shift_hours.exported` (per row) |
| `ai.payroll.void_batch` | `payroll_batches.voided` |
| `ai.payroll.download_csv` | (no business event; just download audit) |
| `ai.documents.read_bytes` | (no business event; just access audit) |
| `ai.privacy.create_request` | `privacy.request_created` |
| `ai.privacy.claim` | `privacy.request_claimed` |
| `ai.privacy.fulfill` | `privacy.request_fulfilled` |
| `ai.privacy.reject` | `privacy.request_rejected` |
| `ai.backup.run_now` | `backup_runs.created` |
| `ai.backup.run_drill_now` | `restore_drills.created` |
| `ai.backup.drill_marked_ok` | (manual marker) |

### Autonomous safe events (Mode 4)

| Event | Pair |
|---|---|
| `ai.notifications.mark_read` | `notification.read` |

(Mode 4 is intentionally tiny.)

### Meta events

| Event | When |
|---|---|
| `ai.tool_invoked` | Generic counter — every tool call (this row coexists with the specific `ai.<surface>.<action>` row; let's keep both for cheap filtering). |
| `ai.tool_blocked` | A tool was called but blocked by RBAC, by safety rule, or by stale-row guard. Payload: `reason`. |
| `ai.tool_failed` | A tool's underlying mutation failed. Payload: `errorMessage`, `errorCode`. |
| `ai.indexing_completed` | RAG indexer finished a run (counts). |
| `ai.indexing_skipped` | RAG indexer skipped a source. |
| `ai.indexing_violation` | RAG indexer attempted a forbidden source. **P0.** |
| `ai.consent.refusal` | AI refused a request to accept consent on someone's behalf. Tracks how often the boundary is tested. |
| `ai.boundary_refusal` | AI refused any other safety-rule-tagged request. Payload: which rule. |

---

## Payload schema

`audit_log` columns: `user_id`, `action`, `resource`, `resource_id`, `before`, `after`, `ip`, `userAgent`, `createdAt`.

For AI rows:

- **`user_id`**: the human who's logged in. AI is not a separate identity; it acts as the human.
- **`action`**: from the catalog above.
- **`resource`**: the canonical table the action targets (e.g. `shift_hours`).
- **`resource_id`**: the row id (or `null` for read-many calls).
- **`before`**: state of the row before mutation (read calls: `null`).
- **`after`**: state of the row after mutation, PLUS metadata:
  ```jsonc
  {
    "...": "...",
    "via": "ai_assisted",         // or "ai_autonomous" for Mode 4
    "tool": "hours.approve",
    "confirmedAt": "<ISO ts>",     // when human clicked confirm
    "confirmationCopy": "Goedkeur deze rij (Daniel @ Lute, €120)",
    "inputs": { ... },             // tool inputs as provided to the AI
    "aiSuggestion": { ... },       // what the AI's preview showed
    "anomalyFlags": [...]
  }
  ```
- **`ip`** + **`userAgent`**: the human's session.

For read-only `ai.tool_invoked` rows, the `after` carries the tool name + sanitized inputs.

For `ai.tool_blocked`:

```jsonc
{
  "tool": "consent.accept",
  "reason": "FORBIDDEN_TOOL_FOR_AI",
  "user_kind_attempted": "super_admin",
  "inputs_sanitized": { ... }
}
```

---

## Retention

`audit_log` is **append-only** at the DB level. No DELETE permission for any application role.

Retention policy (per `retention_policies` table when shipped — PR-CHEF-10):

| Event class | Retention |
|---|---|
| Authentication events (`auth.*`) | 7 years (legal trail) |
| Financial events (`shift_hours.*`, `payroll_batches.*`, `shift_hour_corrections.*`) | 7 years (tax requirement NL) |
| Profile + identity events (`chef.profile_*`, `client.profile_*`) | 7 years |
| Consent events (`consent.*`) | 10 years (AVG burden of proof) |
| Privacy request events (`privacy.*`) | 7 years |
| AI read events (`ai.*` Mode 1 + 2) | 2 years (operational) |
| AI write events (`ai.*` Mode 3 + 4) | matches the paired business event class |
| AI blocked / refused events (`ai.tool_blocked`, `ai.boundary_refusal`, `ai.consent.refusal`) | 5 years (forensic — patterns of abuse) |
| Notification / email events (`notification.*`, `email.*`) | 2 years |
| Backup events (`backup_runs.*`, `restore_drills.*`) | 5 years |

After retention horizon, `workers/retention.ts` (PR-CHEF-10) purges. Some categories are anonymised rather than deleted (replace `user_id` with hash) to preserve aggregate statistics.

---

## Forensic queries

### Q1: "What did the AI do for Lisa today?"

```sql
SELECT created_at, action, resource, resource_id, after->>'tool', after->>'confirmationCopy'
FROM audit_log
WHERE user_id = '<lisa.id>'
  AND action LIKE 'ai.%'
  AND created_at >= current_date
ORDER BY created_at DESC;
```

### Q2: "How many approvals did the AI assist with vs. how many were direct?"

```sql
SELECT
  COUNT(*) FILTER (WHERE action = 'ai.hours.approve') AS ai_assisted,
  COUNT(*) FILTER (WHERE action = 'shift_hours.admin_approved' AND NOT EXISTS (
    SELECT 1 FROM audit_log b
    WHERE b.action = 'ai.hours.approve'
      AND b.resource_id = audit_log.resource_id
      AND b.created_at BETWEEN audit_log.created_at - interval '1 minute' AND audit_log.created_at
  )) AS direct
FROM audit_log
WHERE created_at >= current_date - 30
  AND action IN ('ai.hours.approve', 'shift_hours.admin_approved');
```

### Q3: "Which AI refusals happened most often?"

```sql
SELECT after->>'reason' AS reason, COUNT(*) AS n
FROM audit_log
WHERE action = 'ai.tool_blocked'
  AND created_at >= current_date - 30
GROUP BY 1
ORDER BY n DESC;
```

### Q4: "Did anyone try to AI-bypass the consent gate?"

```sql
SELECT user_id, created_at, after->>'inputs_sanitized'
FROM audit_log
WHERE action IN ('ai.tool_blocked', 'ai.consent.refusal')
  AND after->>'tool' = 'consent.accept'
ORDER BY created_at DESC;
```

### Q5: "How many AI Mode 3 confirmations did Maarten do this week?"

```sql
SELECT action, COUNT(*) AS n
FROM audit_log
WHERE user_id = '<maarten.id>'
  AND action LIKE 'ai.%'
  AND after->>'via' = 'ai_assisted'
  AND created_at >= current_date - 7
GROUP BY action
ORDER BY n DESC;
```

### Q6: "Trace a single decision — show me everything around `shift_hours #abc`."

```sql
SELECT created_at, user_id, action, before, after
FROM audit_log
WHERE resource = 'shift_hours' AND resource_id = 'abc'
ORDER BY created_at;
```

This returns the entire trust-chain history, including any AI assists.

---

## Observability beyond `audit_log`

### Structured logs (stdout, JSON)

The AI orchestration layer also emits structured logs. These are NOT in `audit_log` (which is append-only DB), but in Vercel logs + Railway logs:

```jsonc
{
  "level": "info",
  "ts": "...",
  "msg": "ai.tool_invoked",
  "user_id": "...",
  "user_kind": "internal",
  "tool": "hours.list_queue",
  "duration_ms": 142,
  "rag_chunks_returned": 8,
  "llm_provider": "anthropic",
  "model_version": "claude-opus-4-7",
  "tokens_in": 1234,
  "tokens_out": 567,
  "tools_invoked_count": 2,
  "tools_blocked_count": 0
}
```

These power the operational dashboards: latency p50/p95, token cost per role per day, refusal rate, tool-blocked rate.

### Metrics

When the AI ships:
- `ai_calls_total` (counter, by tool name)
- `ai_call_duration_ms` (histogram)
- `ai_tokens_in` / `ai_tokens_out` (counters; cost tracking)
- `ai_refusal_total` (counter)
- `ai_block_total` (counter, by reason)
- `ai_confirmation_total` (counter; how often Mode 3 buttons are pressed)
- `ai_confirmation_cancelled_total` (counter; how often the user backs out at the confirm step — useful UX signal)

---

## Privacy considerations

The audit itself carries PII. Treat `audit_log` as `restricted` per `rag-source-catalog.md`:

- Never indexed for RAG.
- Read via `audit.search` tool only.
- Caller can see own actions; admin sees all; super_admin sees all (including auth events).

Retention purges replace `user_id` with a salted hash for old rows to preserve aggregate stats without re-identification. The hash uses a per-table secret — `AUDIT_HASH_SECRET` env var (planned PR-CHEF-10).

---

## Pre-flight checklist for AI-related PRs

- [ ] Every tool emits the right `ai.<surface>.<action>` event.
- [ ] Mode 3 actions emit BOTH the `ai.*` and the business event.
- [ ] `before`/`after` JSON includes inputs, confirmationCopy, anomaly flags.
- [ ] Blocked actions write `ai.tool_blocked` with reason.
- [ ] Forensic Q1 returns the expected rows in a manual smoke test.
- [ ] Retention policy row exists for new event class (if novel).
- [ ] Structured logs include the standard fields (duration, tokens, RAG hits).
- [ ] No PII in structured logs (use ids, never raw PII).
