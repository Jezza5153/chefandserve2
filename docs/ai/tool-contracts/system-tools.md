# Tool Contracts — System Cockpit (super_admin reads)

> Read-only tools behind `/admin/system` — the command center to "find problems
> fast". Wraps `src/lib/domain/system-intel.ts` (attention ranking + health
> rollup) and the `/api/health` primitives. super_admin only. Usage € costs are
> supplied later; the tools surface counts now and cost when available.

---

## Tool: system.health_rollup

### Purpose
One overall status (operationeel / aandacht / kritiek) plus the component
breakdown (db, email/Resend, R2, auth secret), so the PA can answer "is alles
gezond?" with a grounded yes/no.

### Inputs
(none)

### Required role
`super_admin` (read).

### Read scope
`/api/health` primitives directly: `db SELECT 1`, `env.RESEND_API_KEY`,
`r2IsConfigured()`, `env.AUTH_SECRET`; `system-intel.systemHealthRollup`.

### Write scope
(none)

### Dry-run result shape
`{ overall: 'operationeel'|'aandacht'|'kritiek', components: { db, email, r2, auth } }`

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.system.health_rollup`.

---

## Tool: system.attention_queue

### Purpose
Ranked system problems: critical errors, failed outbox, overdue privacy
requests, stale/failed backup, health failures — newest/severest first
(`system-intel.rankSystemItems`, priority 1-8).

### Inputs
- limit?: number — default 20

### Required role
`super_admin`.

### Read scope
`error_log`, `integration_outbox`, `privacy_requests`, backup status, health.

### Write scope
(none)

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.system.attention_queue`.

---

## Tool: system.usage

### Purpose
Surface communication + AI consumption: email sends (live, from
`email_messages`), WhatsApp (manual until the API lands), AI tokens (concept).
Cost € is layered in once supplied.

### Inputs
- window?: '24h' | '7d' | '30d' — default '24h'

### Required role
`super_admin`.

### Read scope
`email_messages` counts; WhatsApp + AI usage placeholders until wired.

### Write scope
(none)

### Dry-run result shape
`{ window, email: { sent, failed }, whatsapp?: {...}, ai?: { tokens, estCostCents? } }`

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.system.usage`.

---

## Hard rules

1. super_admin only — never reachable while impersonating (super_admin is
   stripped by the overlay), and `/admin/system` is on the destructive denylist.
2. Read-only. Acting on a problem (retry outbox, fulfil privacy request) routes
   through the relevant write tool with its own confirmation + carve-out.
3. Quote real counts; mark WhatsApp/AI/cost as estimate or "nog niet gekoppeld".
