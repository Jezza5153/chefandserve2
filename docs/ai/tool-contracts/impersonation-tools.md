# Tool Contracts — Impersonation ("Bekijk als")

> Human super_admin impersonation. **The AI never STARTS or STOPS impersonation**
> — that is a person-to-person trust action a human performs. The only AI-callable
> tool here is a read ("is a session active?") used to caveat answers. The PA's
> own way of acting for a user is the separate service-identity model in
> [`../ai-pa-access-model.md`](../ai-pa-access-model.md).

Code: `src/lib/domain/impersonation.ts`, `src/middleware.ts`,
`src/lib/impersonation-denylist.ts`, routes `src/app/api/impersonate/[userId]` + `/stop`.

---

## Tool: impersonation.read_active

### Purpose
Tell the AI whether the current request is running inside a "Bekijk als" session,
so it can caveat ("Let op: je kijkt nu als Maarten") and avoid implying the real
super_admin did something the impersonated user did.

### Inputs
- (none) — reads the effective session.

### Required role
any authenticated (the marker is on the effective session).

### Read scope
`session.user.impersonator` (set by `applyImpersonation`); optionally the
`cs_impersonate_sid` correlation id.

### Write scope
(none — read-only)

### Preconditions
none.

### Side effects
none.

### Dry-run result shape
`{ impersonating: boolean, targetName?: string, targetKind?: 'chef'|'client'|'internal' }`

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.impersonation.read_active`.

### Rollback strategy
n/a.

---

## Tool: impersonation.start — HUMAN ONLY (AI: forbidden)

### Purpose
Begin viewing AS another user. **Not an AI tool.** Documented here so the AI
knows to REFUSE and point the human to the "Bekijk als" button.

### Why forbidden for AI
Impersonation is a human accountability mechanism: a real super_admin chooses to
act as someone. Letting the AI initiate it would create an unaccountable
identity swap. The AI may *explain* it ("Klik op 'Bekijk als' bij Maarten") but
never call it.

### Server behaviour (for reference)
`startImpersonation(targetUserId, actorUserId)` sets `cs_impersonate_target`,
`cs_impersonate_actor`, `cs_impersonate_sid` (HttpOnly, 1h) and writes
`impersonation.start` with `after._imp`. Cannot impersonate another super_admin.
While active, the denylist + `assertImpersonationAllowed()` block destructive ops.

### Audit events
`impersonation.start` (human), `ai.impersonation.start_refused` (if the AI is asked).

---

## Tool: impersonation.stop — HUMAN ONLY (AI: forbidden)

### Purpose
End impersonation. Native form POST to `/api/impersonate/stop`, always available
(not matched by the write denylist). **Not an AI tool** — same reasoning as start.

### Server behaviour
`stopImpersonation()` clears the three cookies and writes `impersonation.stop`
with `after._imp`.

### Audit events
`impersonation.stop` (human).

---

## Hard rules

1. The AI has **no** write path into impersonation — `start`/`stop` are human-only.
2. The AI must never claim to "become" a user; if asked, it refuses and explains
   the human "Bekijk als" button (or, for doing-on-behalf, the PA delegation model).
3. The AI may use `impersonation.read_active` to add a caveat to its answers, but
   must not change behaviour in a way that hides the impersonation from the audit.
