# Tool Contracts — Matching / Staffing Intelligence (reads)

> Read-only tools wrapping `src/lib/domain/staffing-intelligence.ts` (+ `geo` /
> `travel` / `chef-history`): rank candidates for a shift and EXPLAIN the ranking
> ("waarom niet nr 1?"). The AI proposes; placing a chef goes through
> `shift-tools.md` (`shifts.propose_placement`, assisted_execute).

---

## Tool: matching.rank_candidates

### Purpose
Return the top-N chefs for a shift, ranked by vakniveau match, availability,
distance/travel, history with the klant, and rating — so the operator (or Admin
PA in draft mode) sees a grounded shortlist.

### Inputs
- shiftId: string
- limit?: number — default 5

### Required role
`owner` | `super_admin` | `coordinator` (read).

### Allowed user kinds
internal.

### Read scope
`shifts`, `chefs`, `chef_availability`, `placements` (history), `ratings`
(N≥5 averages), `geo`/`travel` for distance. Pure ranking in
`staffing-intelligence`.

### Write scope
(none — read-only)

### Preconditions
Shift exists; chef cross-tenant rules apply (no PII leak beyond match facts).

### Side effects
none.

### Dry-run result shape
```
[{ chefId, name, score, reasons: [
    { factor: 'vakniveau'|'availability'|'distance'|'history'|'rating', detail }
  ] }]
```

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.matching.rank_candidates`.

### Rollback strategy
n/a.

---

## Tool: matching.explain

### Purpose
Relative explanation: why candidate B ranks below candidate A ("waarom niet
nr 1?") — the same logic behind the roster UI's explanation chip.

### Inputs
- shiftId: string
- chefId: string — the candidate to explain
- comparedToChefId?: string — default the #1 candidate

### Required role
`owner` | `super_admin` | `coordinator`.

### Read scope
Same as `rank_candidates`.

### Write scope
(none)

### Dry-run result shape
`{ chefId, rank, deltaVsTop: [{ factor, theirs, top, gap }] }`

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.matching.explain`.

---

## Hard rules

1. Read-only. Proposing/confirming a placement is `shift-tools.md`
   (assisted_execute) — never autonomous.
2. Reasons cite real factors; the AI never invents a match reason.
3. Cross-tenant: candidate facts are match-relevant only (no BSN/IBAN/contact
   beyond what the roster legitimately shows the operator).
