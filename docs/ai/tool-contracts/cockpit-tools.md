# Tool Contracts — Business Cockpit (reads)

> Read-only tools that surface the `/admin/business` cockpit's derived facts:
> bezetting / loonkost, "Vandaag & morgen", and the ranked "Aandacht nodig"
> queue. Wraps `src/lib/domain/dashboard-intel.ts` + `src/lib/domain/roster-format.ts`.

Sister: [`../role-permission-matrix.md`](../role-permission-matrix.md),
[`system-tools.md`](./system-tools.md) (super_admin system view).

---

## Tool: cockpit.business_overview

### Purpose
One call that returns the operator's morning picture: today/tomorrow shifts,
bezetting %, loonkost, and the ranked attention items — so the Admin PA can give
a grounded briefing without inventing numbers.

### Inputs
- horizonDays?: number — default 2 (vandaag + morgen)

### Required role
`owner` | `super_admin` (read).

### Allowed user kinds
internal.

### Read scope
`shifts`, `placements`, `chefs`, `clients`, `shift_hours` (counts/aggregates);
derived via `dashboard-intel` (attention ranking + delta rule) and
`roster-format` (bezetting / onderbezet labels).

### Write scope
(none — read-only)

### Preconditions
none.

### Side effects
none.

### Dry-run result shape
```
{
  window: { from, to },
  bezetting: { filled, open, pct },
  loonkostCents: number,
  shifts: [{ id, client, role, startsAt, status, filled }],
  attention: [{ kind, tone, title, href }]   // ranked, dashboard-intel
}
```

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.cockpit.business_overview`.

### Rollback strategy
n/a.

---

## Tool: cockpit.attention_queue

### Purpose
Just the ranked "Aandacht nodig" list (open shifts, hours awaiting approval,
cancellations, expiring docs) for triage.

### Inputs
- limit?: number — default 20

### Required role
`owner` | `super_admin`.

### Read scope
Same aggregates as above, via `dashboard-intel.rankAttention`.

### Write scope
(none)

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.cockpit.attention_queue`.

---

## Hard rules

1. Read-only — these tools never mutate. Acting on an attention item routes
   through the relevant write tool (hours, shifts, …) with its own confirmation.
2. Numbers are quoted from the query, never estimated. Cite the window.
3. Cross-tenant: owner/super_admin only; no chef/client access to the cockpit.
