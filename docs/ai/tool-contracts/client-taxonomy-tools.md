# Tool Contracts — Client Taxonomy (type / tags / favorite-blocked)

> Classify a klant: business type, free tags, and favorite/blocked chef lists —
> the inputs that feed matching. Wraps `src/lib/domain/client-taxonomy.ts` and the
> `/admin/business/clients/[id]` editor. Read + assisted_execute (admin). These
> are normal "fix a setting" edits — exactly what Bekijk-als / the PA may do.

---

## Tool: client_taxonomy.read

### Purpose
Return a klant's type, tags, and favorite/blocked chef ids (+ names) so the PA can
explain matching ("Hotel X heeft Daniel als favoriet").

### Inputs
- clientId: string

### Required role
`owner` | `super_admin` (read).

### Read scope
`clients` (`type`, `tags`, `favoriteChefIds`, `blockedChefIds`), `chefs` (names).

### Write scope
(none)

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.client_taxonomy.read`.

---

## Tool: client_taxonomy.set_type

### Purpose
Set the klant's business type (e.g. hotel / restaurant / catering / event).

### Inputs
- clientId: string
- type: string  (validated against the allowed set)

### Required role
`owner` | `super_admin`.

### Write scope
`clients.type`. Audit: `clients.update_type`.

### Confirmation requirement
`assisted_execute` (Mode 3).

### Audit events
`ai.client_taxonomy.set_type` + `clients.update_type`.

### Rollback strategy
Re-set to the previous value (captured in `before`).

---

## Tool: client_taxonomy.set_tags

### Purpose
Replace the klant's tag set.

### Inputs
- clientId: string
- tags: string[]

### Required role
`owner` | `super_admin`.

### Write scope
`clients.tags`. Audit: `clients.update`.

### Confirmation requirement
`assisted_execute` (Mode 3).

### Audit events
`ai.client_taxonomy.set_tags` + `clients.update`.

---

## Tool: client_taxonomy.set_favorite_blocked

### Purpose
Add/remove a chef from the klant's favorite or blocked list — a steering input
for matching (not a hard permission).

### Inputs
- clientId: string
- chefId: string
- list: 'favorite' | 'blocked'
- op: 'add' | 'remove'

### Required role
`owner` | `super_admin`.

### Write scope
`clients.favoriteChefIds` / `clients.blockedChefIds`. Audit: `clients.update`.

### Preconditions
Chef exists + not AVG-erased (erased chef ids are scrubbed from these arrays —
see PR-2B AVG). Adding to favorite must not also be in blocked (and vice-versa).

### Side effects
`audit_log`. No external side effects.

### Confirmation requirement
`assisted_execute` (Mode 3).

### Audit events
`ai.client_taxonomy.set_favorite_blocked` + `clients.update`.

### Rollback strategy
Reverse op (remove what was added) — `before` holds the prior arrays.

---

## Hard rules

1. Non-destructive steering inputs → allowed during impersonation + (future) PA
   assisted_execute, audited as the actor.
2. favorite/blocked are MATCHING HINTS, not access control — they never gate a
   chef's portal or data.
3. AVG: never re-introduce an erased chef id; the erasure scrub is authoritative.
