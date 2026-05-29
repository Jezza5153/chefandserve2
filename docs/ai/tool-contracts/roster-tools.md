# Tool Contracts — Rooster cockpit (reads)

> Read-only tools that surface the `/admin/business/roster` control tower's derived
> facts: the Day / Week / Month view-model, the role-broken-down open plekken, the
> confirmation pipeline (bevestigd / wacht / voorgesteld), the priority-ranked
> "Aandacht nodig" list, beschikbaar-niet-ingepland supply, and the plain-Dutch
> executive summary. Wraps `src/lib/domain/roster-intel.ts` (which itself reuses
> `roster-format` for tz/grid + health and `dashboard-intel` for attention ranking).

**Rooster ≠ Planner.** These tools READ the live planning truth and NAVIGATE to a
detail page. They never assign, propose, confirm, publish, or cancel. Every "solve"
affordance routes to [`shift-tools.md`](./shift-tools.md) (proposal/accept/confirm/
cancel) + the existing shift detail page, each with its own confirmation. The
interactive solving surface is the future `/admin/business/planner` (not built).

Sister: [`cockpit-tools.md`](./cockpit-tools.md) (the `/admin/business` glance),
[`matching-tools.md`](./matching-tools.md), [`shift-tools.md`](./shift-tools.md),
[`../source-of-truth-map.md`](../source-of-truth-map.md).

---

## The one grounding guarantee

The page renders ONLY from `buildRosterView(input)`; `roster.overview` returns the
SAME view-model (`rosterAiSummary(vm)` = the `.facts` block below). So the numbers
the AI quotes and the numbers on Maarten's screen are the same object — they cannot
drift. The AI must quote these, never re-derive fill / kritiek / bezetting itself.

---

## Tool: `roster.overview`

### Purpose
One call returns the operator's roster picture for a lens + date: the per-view KPIs
(each carrying its filter), open plekken broken down by dagdeel, kritiek count,
bezettingsgraad, hotels-met-aandacht, open-binnen-48u, beschikbaar-niet-ingepland,
and the plain-Dutch `samenvatting` — so the PA can brief without inventing numbers.

### Inputs
- view: `"day" | "week" | "month"` — default `week` (the employee's saved default).
- date?: `YYYY-MM-DD` — Amsterdam anchor day. Default today.
- filter?: `open | kritiek | onderbezet | role:<dagdeel> | hotel:<id> | conflicts | beschikbaar` — optional read-only narrowing of the body (KPIs stay full-truth).

### Required role
`owner` | `super_admin` (read).

### Allowed user kinds
internal.

### Read scope
`shifts`, `placements` (status counts: confirmed / accepted / proposed +
`min(proposedAt)`), `clients.companyName`; Day view also `chefs` + `chefAvailability`
(date-level) for beschikbaar-niet-ingepland + double-booking detection. Derived via
`roster-intel.buildRosterView` (+ `roster-format`, `dashboard-intel`).

### Write scope
(none — read-only)

### Preconditions
none.

### Side effects
none.

### Dry-run result shape
```jsonc
{
  "view": "day", "dateKey": "2026-05-29",
  "samenvatting": "1 kritiek. 2 open plekken. Diner heeft de meeste druk (1 open). 2 open binnen 48 uur. 2 passende chefs nog niet ingepland.",
  "kpis": [
    { "key": "diensten", "label": "Diensten vandaag", "value": 3 },
    { "key": "open", "label": "Open plekken", "value": 2, "detail": "1 lunch · 1 diner", "filter": "open" },
    { "key": "kritiek", "label": "Kritiek", "value": 2, "filter": "kritiek" },
    { "key": "beschikbaar", "label": "Beschikbaar, niet ingepland", "value": 2, "filter": "beschikbaar" }
  ],
  "openBinnen48u": 2,
  "hotelsMetAandacht": { "count": 1, "names": ["Hotel Okura"] },
  "hardestRole": { "dagdeel": "diner", "open": 1 },        // month: "moeilijkste rol"
  "topClientPressure": { "companyName": "Hotel Okura", "shiftCount": 3, "openSlots": 2 },
  "attention": [{ "kind": "critical_shift", "tone": "red", "title": "Hotel Okura · Lunch kritiek", "detail": "1 open · start over 2u", "href": "/admin/business/shifts/<id>", "cta": "Open dienst" }]
}
```
(For `view=week` the KPI set is diensten / open / hotels-met-aandacht / kritiek and
the body carries `weekHotels` (hotels × 7 days); for `view=month` it is
bezettingsgraad / open / kritieke-dagen / moeilijkste-rol with `monthDays` +
meest-actieve-hotels + rol-tekorten.)

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.roster.overview`.

### Rollback strategy
n/a.

---

## Tool: `roster.open_shifts`

### Purpose
The open plekken for a range, broken down by **role pressure** (dagdeel = ontbijt /
lunch / diner / late, derived from `startsAt`) + the per-shift confirmation pipeline
— so "wat staat er open en wie is al onderweg" is answerable in one read.

### Inputs
- view: `"day" | "week" | "month"`; date?: `YYYY-MM-DD`.
- role?: `ontbijt | lunch | diner | late` — narrow to one dagdeel.

### Required role
`owner` | `super_admin`.

### Read scope
Same as `roster.overview`. Each shift carries: `headcount`, `confirmed`, `accepted`,
`proposed`, `openSlots` (= headcount − (confirmed+accepted)), `teBevestigen`
(accepted covers but not all confirmed → "wacht op bevestiging"), `health`.

### Write scope
(none)

### Dry-run result shape
```jsonc
{
  "openTotal": 6, "byDagdeel": { "ontbijt": 4, "diner": 2 },
  "shifts": [{ "id": "...", "client": "Hotel Okura", "dagdeel": "ontbijt", "roleNeeded": "chef_de_partie",
               "fill": "0/1", "openSlots": 1, "pipeline": { "confirmed": 0, "accepted": 0, "proposed": 1 },
               "when": "start over 19u", "href": "/admin/business/shifts/<id>" }]
}
```

### Confirmation requirement
`read` (Mode 1). Acting on a gap → `shifts.propose_placement` (assisted_execute) on
the detail page; this tool never proposes.

### Audit events
`ai.roster.open_shifts`.

---

## Tool: `roster.attention`

### Purpose
The priority-tiered, self-explaining "Aandacht nodig" list (every item states its
reason + timing — never a bare "Aandacht"): kritiek (under headcount & < 24u) → open
< 48u → onderbezet → wacht-op-bevestiging → wacht-op-reactie (incl. "geen reactie Xu"
from the proposal timestamp) → ontbrekende gegevens, plus Day-view double-bookings.

### Inputs
- view / date (as above); limit?: number — default 20.

### Required role
`owner` | `super_admin`.

### Read scope
Same aggregates, ranked via `roster-intel.buildAttention` →
`dashboard-intel.rankAttentionItems`. Double-bookings via `detectOverlaps`
(same chef, overlapping confirmed/accepted placements that day).

### Write scope
(none)

### Dry-run result shape
```jsonc
{ "items": [{ "kind": "critical_shift", "tone": "red", "icon": "alert-triangle",
              "title": "Hotel Okura · Diner kritiek", "detail": "2 open · start over 5u",
              "href": "/admin/business/shifts/<id>", "cta": "Open dienst" }] }
```

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.roster.attention`.

---

## Tool: `roster.candidates_for_shift`

### Purpose
For an open shift, the ranked passende chefs + "waarom (niet) nr 1?" reasoning — the
read half of supply↔demand. Thin wrapper over `staffing-intelligence` /
`matching.findMatchesForShift` (the SAME engine the shift detail page uses).

### Inputs
- shiftId: text.

### Required role
`owner` | `super_admin`.

### Read scope
`shifts`, `chefs`, `chefAvailability`, `placements`, `clients` — via
`matching.findMatchesForShift` (vakniveau + availability + distance + history +
klanttype). Identical contract to [`matching-tools.md`](./matching-tools.md).

### Write scope
(none — ranking only)

### Dry-run result shape
```jsonc
{ "shiftId": "...", "candidates": [{ "chefId": "...", "name": "Daniel", "score": 96,
    "reasons": ["sous chef", "Amsterdam", "4× eerder bij Lute"], "warnings": [] }] }
```

### Confirmation requirement
`read` (Mode 1). Proposing a candidate → `shifts.propose_placement`
(assisted_execute) — a separate, human-confirmed write on the detail page.

### Audit events
`ai.roster.candidates_for_shift`.

---

## Hard rules

1. **Read + navigate only.** These tools never mutate. Acting on any roster signal
   (propose / confirm / cancel / publish) routes through `shift-tools.md` with its
   own confirmation, or — when Planner ships — into `/admin/business/planner`.
2. **Numbers are quoted from `buildRosterView`, never estimated.** Cite the lens +
   date ("Bron: rooster, dag 29 mei"). Fill / kritiek / bezetting definitions are
   locked in `roster-intel` (see `source-of-truth-map.md`); the AI does not re-derive.
3. **`completed` is past-only.** It never inflates a future/today shift's fill — the
   active rule is gevuld = confirmed ≥ headcount; openSlots = headcount −
   (confirmed + accepted). An accepted-but-unconfirmed slot reads as
   "wacht op bevestiging", never as done.
4. **Beschikbaar-niet-ingepland is admin-only and date-level.** Never expose a free
   chef to a klant via this surface (mirrors the `chefAvailability` rule in
   `source-of-truth-map.md`); the skill split is best-effort (from `segments`).
5. **Cross-tenant:** owner / super_admin only. No chef / klant access to the roster.
6. **No fabricated trend / forecast.** There is no "vs vorige maand", sparkline, or
   predicted demand in this surface — that data isn't stored. The AI must not invent it.
