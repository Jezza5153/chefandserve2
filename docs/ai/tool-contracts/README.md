# Tool Contracts

> Every typed function the AI may call. Each tool maps to an existing or planned server action / API route. Tools don't have their own implementation — they're a typed wrapper around the human-callable mutation, gated by RBAC + the safety rules in [`../ai-safety-rules.md`](../ai-safety-rules.md).

Sister doc: [`../role-permission-matrix.md`](../role-permission-matrix.md) — which role may call which tool in which mode.

---

## Tool contract template

Every tool in this folder follows this shape:

```
## Tool: <namespace.action>

### Purpose
One sentence — what business need this addresses.

### Inputs
- field: type — description

### Required role
super_admin | owner | bookkeeper | coordinator | chef | client (server-enforced)

### Allowed user kinds
internal | chef | client

### Read scope
Which tables/views the tool reads.

### Write scope
Which tables it writes (empty for read-only tools).

### Preconditions
Atomic guards (e.g. row must be in status=X; user must own entity).

### Side effects
Outbox · notifications · emails · audit log entries.

### Dry-run result shape
What --dry-run returns so AI can show preview before execution.

### Confirmation requirement
draft | assisted_execute | autonomous (Mode per ai-safety-rules.md)

### Audit events
ai.tool_suggested · ai.tool_executed · ai.tool_blocked

### Rollback strategy
How to undo (correction row · void · soft-delete · manual).
```

---

## The four modes

| Mode | Behavior | When |
|---|---|---|
| `read` | AI calls; data flows back into LLM context. Always allowed if RBAC permits. | Read-only tools. |
| `draft` | AI prepares a preview; never calls the mutation. Human sees the draft + acts via the existing UI. | High-risk mutations the AI should never execute even with confirmation. |
| `assisted_execute` | AI prepares a preview; human clicks an explicit confirmation button; AI then calls the mutation. | The typical write tool. |
| `autonomous` | AI calls the mutation without confirmation. Rare, restricted to low-risk reversible actions (e.g. `notifications.mark_read` on own row). | Mode 4 in `ai-safety-rules.md`. |

---

## Hard rules common to every tool

1. **AI inherits the caller's RBAC.** No escalation. A chef calling a tool gets chef's permissions; if the matrix says `—` for the role, the tool refuses with a polite explanation.
2. **Every call emits an audit row.** Even reads emit `ai.tool_invoked` with the inputs. Writes emit BOTH `ai.<action>` (the AI's suggestion + confirm) AND the underlying business audit (e.g. `shift_hours.admin_approved`).
3. **Atomic guards on every write.** `UPDATE … WHERE id=? AND status='<expected>'`. Stale rows fail visibly.
4. **No external API call inside a transaction.** Outbox-only.
5. **No tool may bypass `consent.accept`, `auth.reset_2fa` autonomously**, or any forbidden action in `ai-safety-rules.md`.
6. **Per-row mutations, never silent bulks.** Every approval, every send, every rejection is its own audit row.
7. **Confirmation copy contains the exact action + destination.** "Verstuur dit bericht naar daniel@example.com" — never a generic "OK".
8. **Dry-run shows everything that would happen** — DB writes, emails fired, notifications created, outbox rows added.

---

## Catalog of tool files

| File | Surface |
|---|---|
| [`hours-tools.md`](./hours-tools.md) | Hours trust chain — submit, sign, approve, reject, draft reminders, corrections. |
| [`shift-tools.md`](./shift-tools.md) | Shift discovery, candidate matching, placement proposal/cancel/confirm. |
| [`notification-tools.md`](./notification-tools.md) | Drafting + sending messages, listing unread, marking read. |
| [`profile-tools.md`](./profile-tools.md) | Reading profiles, drafting change requests, approving/rejecting. |
| [`integration-tools.md`](./integration-tools.md) | Outbox health, retry, payroll batches, R2 access. |
| [`privacy-tools.md`](./privacy-tools.md) | Privacy requests, consent reading. `consent.accept` is FORBIDDEN. |
| [`client-tools.md`](./client-tools.md) | Klant portal — profile + shift hub reads. |
| [`client-request-tools.md`](./client-request-tools.md) | Klant shift request submit / cancel / change. |
| [`client-template-tools.md`](./client-template-tools.md) | Recurring shift templates (admin-owned). |
| [`rating-tools.md`](./rating-tools.md) | Klant rating / feedback (internal-only, N≥5 averages). |
| [`cockpit-tools.md`](./cockpit-tools.md) | Business cockpit reads — bezetting / loonkost + attention queue. |
| [`system-tools.md`](./system-tools.md) | System cockpit — health rollup, attention queue, usage (super_admin). |
| [`matching-tools.md`](./matching-tools.md) | Candidate ranking + "waarom niet nr 1?" explanation. |
| [`profile-data-request-tools.md`](./profile-data-request-tools.md) | Admin "vul je gegevens aan" requests + completeness. |
| [`client-taxonomy-tools.md`](./client-taxonomy-tools.md) | Klant type / tags / favorite-blocked steering inputs. |
| [`impersonation-tools.md`](./impersonation-tools.md) | "Bekijk als" — read-active only; start/stop are HUMAN-only. |

---

## Co-evolution

When a new server action that mutates state lands in code:

1. Add the tool contract to the relevant file (or create a new one + add to this catalog).
2. Add a row to [`../role-permission-matrix.md`](../role-permission-matrix.md).
3. Add at least one golden test to [`../ai-evaluation-set.md`](../ai-evaluation-set.md).
4. If the action is high-impact (financial, identity, consent, permission), also update [`../ai-safety-rules.md`](../ai-safety-rules.md).
5. Cite the matching `WORKFLOW.md` section.

---

## Implementation note

This folder is documentation, not code. The actual TypeScript tool-definitions + handlers will live in `src/lib/tools/` (per `AI_INTEGRATION.md` §7 code organisation). When that lands:

- `src/lib/tools/definitions.ts` — Claude/OpenAI function-calling JSON schemas, generated from these contracts.
- `src/lib/tools/handlers.ts` — maps each tool to the domain function in `src/lib/domain/`, applies RBAC, emits audit.

The contracts in this folder are the source of truth; the code mirrors them, not the other way around.
