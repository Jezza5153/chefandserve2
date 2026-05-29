# Workflow: Rooster triage (read the cockpit → act on the detail page)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) Part 1.6 (the planning surface).
> The roster cockpit `/admin/business/roster` is the **control tower**: it SHOWS the
> live planning truth and NAVIGATES to where the operator acts. It never mutates.

## Purpose

Maarten opens the roster to answer, at a glance: **waar gaat de planning stuk · wie
staat waar · welke rol mist · welke chef kan ik gebruiken · waar klik ik nu.** One
toggle gives three lenses on the same engine output:

- **Dag** — dispatch board: per-hotel 06:00–23:00 timeline + "Beschikbaar, niet
  ingepland" supply rail + double-booking detection.
- **Week** — staffing map: hotels × 7 days, venue-first, with hotels-met-aandacht.
- **Maand** — planning radar: risk-tinted bezetting heatmap + meest-actieve-hotels +
  rol-tekorten + moeilijkste-rol.

The triage flow is always: **Dashboard ("3 dingen vragen aandacht") → Rooster
(inspect the gap) → shift / chef detail page (act) → Rooster reflects the new truth.**

---

## Rooster ≠ Planner (the scope boundary)

**Rooster laat zien wát de planning is. Planner helpt je de planning te maken.**
Rooster is read-only operational truth + triage + navigation. The interactive
**solving** surface (open-diensten backlog, candidate board with
[Voorstellen]/[Inplannen], scenario drafting, change-impact preview, publish/send to
chefs + klanten) is the SEPARATE future page `/admin/business/planner` — not built.
In Rooster every "solve" affordance is a **read + navigate**: a gap's CTA is
"Open dienst" → shift detail; the chef rail links to Chef 360. Never an inline assign.

---

## Actors

- **Admin (`owner`+ / `super_admin`)** — reads the cockpit, navigates to act.
- **AI PA (read mode)** — answers questions + briefs from the same view-model.
- **System** — none here (this surface fires no writes, no outbox, no email).

---

## Source tables (all read)

- `shifts` — `startsAt`, `endsAt`, `roleNeeded`, `headcount`, `status`, `location`/`city`.
- `placements` — status counts (confirmed / accepted / proposed) + `min(proposedAt)`.
- `clients.companyName` — the venue label.
- `chefs` + `chefAvailability` (Day view) — beschikbaar-niet-ingepland supply.

No table is written by this surface.

---

## The locked definitions (computed once in `roster-intel`, never re-derived)

| Concept | Rule |
|---|---|
| dagdeel (the block's time-of-day "rol") | from Amsterdam `startsAt`: <11 ontbijt · <16 lunch · <21 diner · else late. **Not** `roleNeeded` (that's vakniveau/skill). |
| activeCovered | `confirmed + accepted` |
| openSlots | `max(0, headcount − activeCovered)` |
| gevuld (green, "klaar") | `confirmed ≥ headcount` (strict — only a CONFIRMED chef locks a slot) |
| teBevestigen ("wacht op bevestiging") | `activeCovered ≥ headcount AND confirmed < headcount` |
| kritiek | active shift under headcount AND starts ≤ `criticalHours` (default 24u) |
| onderbezet | `openSlots > 0 AND confirmed > 0` |
| bezettingsgraad | `Σ min(confirmed, headcount) / Σ headcount` over active shifts |
| `completed` | PAST/historical only — never inflates a future/today shift |

Thresholds + Dutch labels come from `getRosterSettings(userId)`
(`DEFAULT_ROSTER_SETTINGS`); the planned Instellingen page feeds the same helpers.

---

## What the AI may read

Through `tool-contracts/roster-tools.md` (`owner` / `super_admin` only):

- `roster.overview(view, date)` — the full view-model + the plain-Dutch samenvatting.
- `roster.open_shifts` — open plekken broken down by dagdeel + the confirmation pipeline.
- `roster.attention` — the priority-ranked, self-explaining aandacht list + overlaps.
- `roster.candidates_for_shift(shiftId)` — ranked passende chefs (wraps matching).

The AI quotes these numbers verbatim. It cites the lens + date. It never re-computes
fill / kritiek / bezetting, and never fabricates a trend ("vs vorige maand") — that
data isn't stored.

---

## What the AI may draft

- A briefing: "3 open binnen 48u — 2 ontbijt (Okura), 1 diner (Pulitzer); 4 passende
  chefs nog niet ingepland." (read-only, from `roster.overview`).
- A candidate shortlist for an open gap (from `roster.candidates_for_shift`) — the AI
  ranks; Maarten chooses + proposes on the detail page.

---

## What the AI may execute only after explicit human confirmation

Nothing on THIS surface. Every action leaves the roster:

| Operator intent | Where it actually happens | Tool / confirmation |
|---|---|---|
| Vul een open plek | shift detail page | `shifts.propose_placement` (assisted_execute) — see [shift-proposal-accept-confirm.md](./shift-proposal-accept-confirm.md) |
| Bevestig een geaccepteerde plaatsing | shift detail page | `shifts.confirm_placement` (assisted_execute) |
| Annuleer een dienst/plaatsing | shift detail page | `shifts.cancel` (assisted_execute, reason required) |
| Los een dubbele boeking op | chef 360 / shift detail | human edit — Rooster only FLAGS it |

---

## AI must never do

- **Mutate anything from the roster surface.** It is read + navigate by construction.
- **Assign / propose / confirm / cancel / publish inline.** Those are the Planner's
  job (future) or the detail page's (today), each with its own confirmation.
- **Treat `completed` as fill** for a future/today shift, or read an accepted-but-
  unconfirmed slot as "done".
- **Expose a beschikbaar-niet-ingepland chef to a klant.** Admin-only, date-level.
- **Invent a forecast, trend arrow, sparkline, or "verwachte vraag"** — unstored.
- **Re-derive the locked definitions.** Quote `roster-intel`'s output.

---

## Audit keys

Reads only (no business mutation on this surface):

- `ai.roster.overview`
- `ai.roster.open_shifts`
- `ai.roster.attention`
- `ai.roster.candidates_for_shift`

Acting on a signal emits the write tool's own paired keys (`ai.shifts.propose_placement`
+ `placements.proposed`, etc.) on the detail page — see the shift playbook.

---

## Notifications / outbox

None from this surface. The roster reads; the detail-page write tools fire the
notifications + outbox documented in [shift-proposal-accept-confirm.md](./shift-proposal-accept-confirm.md).

---

## Edge cases

- **No shifts in the period** — the page shows an empty state; `roster.overview`
  returns empty KPIs + an empty samenvatting. The AI says "geen diensten" — it does
  not invent activity.
- **A `?filter=` is active** — the KPI strip + samenvatting stay full-truth; only the
  body (timeline / grid / heatmap) + the attention rail narrow. The AI should report
  the full numbers and note the active filter.
- **Double-booking (Day)** — flagged at the top of the rail ("X dubbel geboekt
  19:00–20:00", links to Chef 360). Rooster only flags; the fix is a human edit.
- **Missing data** (shift zonder headcount / locatie, onbekende klant) — surfaces as
  a `missing_data` aandacht item ("gegevens missen") because it blocks planning.
- **Beschikbaar count vs the matcher** — the supply rail uses the SAME availability +
  not-placed filter as `matching.findMatchesForShift`, so the rail and the candidate
  list agree on who's free.

---

## Example user commands (admin)

- "Hoe staat het rooster er vandaag voor?" → `roster.overview(day)` → quote the
  samenvatting + open/kritiek/beschikbaar.
- "Wat staat er deze week open en welke rol mist het meest?" →
  `roster.open_shifts(week)` → byDagdeel breakdown + the hotels involved.
- "Wat moet ik nu als eerste oppakken?" → `roster.attention` → the top kritiek item
  with its reason + timing + the "Open dienst" link.
- "Wie kan ik voorstellen voor die open ontbijtdienst bij Okura?" →
  `roster.candidates_for_shift(shiftId)` → ranked list; then Maarten proposes on the
  detail page.

## Expected AI answer style

- Cite the lens + date: "Rooster, dag 29 mei."
- Lead with the worst: "1 kritiek (Okura, diner, start over 5u)."
- Always give the navigation: "Open de dienst om voor te stellen → /admin/business/shifts/<id>."
- Never present a roster read as an action taken ("ik heb ingepland") — it's read-only.
