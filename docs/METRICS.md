# METRICS.md — wat elk getal betekent

> **Voor Maarten.** Elk getal dat het systeem laat zien staat hier met de exacte formule
> erachter. Als twee schermen een ander getal tonen voor hetzelfde ding, staat het antwoord
> hier — of het staat er niet, en dan is dát het probleem.

**This file owns:** the definition of every business number — its formula, its window, its
source, and whether it is live or from a nightly snapshot.
**It does not own:** counts of things in the repo (→ [STATE.generated.md](STATE.generated.md))
or what is on in prod (→ [MEMORY.md](../MEMORY.md)).

**The rule: one metric, one definition, one place.** If you need a number that already exists,
call the existing read-model. Never recompute it inline — that is how "filled" ended up
meaning three different things.

---

## The foundation

Two nightly snapshot tables, written by the Railway worker `workers/metrics-snapshot.ts` at
00:30 Europe/Amsterdam, idempotent per (entity, date):

- `chef_metrics_daily` — one row per active chef per day
- `client_metrics_daily` — one row per active klant per day

**Money only ever comes from final hours.** Every euro in the system is derived from
`shift_hours` with `status IN ('admin_approved','exported')`, dated on `admin_approved_at`.
Draft and client-signed hours never count. This is why the klant dashboard's "besteed" lags
reality — that is intentional, not a bug, but say so in the UI.

---

## Canonical definitions

### Filled slot

> **One definition, and this is it.**
> A slot is **filled** when a placement on that shift has status `confirmed` or `completed`,
> **capped at the shift's `headcount`**. Over-placement never inflates a fill number.

```sql
least(count(p.*) filter (where p.status in ('confirmed','completed')), s.headcount)
```

This was genuinely inconsistent across the codebase, which is why no fill-rate metric could be
trusted:

| Where | Was | Now |
| --- | --- | --- |
| `src/lib/domain/platform-rollups.ts` | `confirmed+completed`, capped | canonical ✅ |
| `workers/metrics-snapshot.ts` | `confirmed+completed`, **uncapped** — `filled_slots` could exceed `slots_count` | fixed to cap per shift |
| `src/lib/ai/read-model/demand-forecast.ts` | `confirmed` only, capped | intentionally different — see below |

`demand-forecast` looks at **upcoming** shifts, where `completed` cannot occur, so `confirmed`
only is correct there. It is the same definition, not a competing one.

> ℹ️ `client_metrics_daily` rows written **before 2026-07-26** used the uncapped count, so
> they are wrong wherever a shift was over-placed. Checked on dev: across every client-day
> with placements, the old and new definitions agree exactly — nothing is currently
> over-placed, so this is a guard against a latent bug rather than a correction of existing
> data. **Run the same comparison against prod before assuming no backfill is needed**;
> if any row differs, re-run the snapshot worker for those dates.

### Revenue, chef pay, margin

```
revenueCents  = Σ (client_rate_cents × worked_minutes / 60)
chefPayCents  = Σ (chef_rate_cents   × worked_minutes / 60)
marginCents   = revenueCents − chefPayCents
```

> **This is a rate spread, not a contribution margin.** It excludes employer charges and
> social premiums, travel reimbursement as actually paid, no-show and replacement costs,
> discounts, and bad debt. Call it *tariefmarge* in the UI. `estimateMargin()` (used per-shift,
> before the fact) *does* subtract estimated travel cost, so the two numbers legitimately
> differ — do not "reconcile" them.
>
> **Per-shift contributiemarge-INDICATIE (2026-07-27):** the `shifts.margin` AI tool uplifts
> the chef cost by `employerChargesPct` from the money-assumptions page (default 30%,
> owner-tunable). The snapshot tables stay tariefmarge — one definition per surface, labeled.

### Occupancy (realised, 30 days)

Slots and filled over shifts with `starts_at` in the last 30 days. **Backward-looking only** —
it says nothing about whether next week is covered.

### Capacity utilisation

```
utilizationPct = hours worked (30d) / (active chefs × 32 × 30/7)
```

**32 hours per chef per week is an assumption, not data.** The UI states it. It stays an
estimate until chefs declare offered capacity — `chef_availability` records *blocked* days,
never offered ones.

---

## What is missing, and what it would take

The numbers an agency owner needs daily that this system cannot produce today. Ordered by
value ÷ effort.

### 1. Fill rate, forward-looking — **BUILT (2026-07-27)**

`getKpiBaselines().forwardFill` — canonical capped filled-slot definition over upcoming
**committed** shifts (status `open`/`filled`; a `request` is a klant wish that may still be
declined and counts nowhere). Default 7 days. Surfaces: `/admin/business/insights` ("Vooruit · de stuurgetallen")
and the AI `reports.platform_kpi` payload. Live query, not yet snapshotted as a series.

### 2. Time-to-fill

"How long from shift request to confirmed chef." The single most important operational KPI
after fill rate, and it does not exist anywhere.
**BUILT (2026-07-27).** `getKpiBaselines().timeToFill`: median + p90 of
`shifts.created_at → placements.confirmed_at` over confirms in the last 90 days (guard:
`confirmed_at > created_at`). Fully backfillable — both timestamps were always stored.
Surfaces: insights + `reports.platform_kpi`.

### 3. No-show and late-cancellation rate

`chef_metrics_daily` already counts cancellations per chef per day, but nothing turns it into a
ratio, and a cancellation three weeks out is counted the same as one at 06:00 on the day.
**Blocked on:** a no-show event distinct from a cancellation, and a window split (>48h / 24-48h
/ same-day — the thresholds already exist in `src/lib/cancellation-severity.ts`).

### 4. Repeat-client rate and retention

No cohort measure exists: what share of last quarter's klanten booked again, revenue from
existing vs new, average client lifetime and value. `client_metrics_daily` already holds
per-client daily activity, so this needs **no new table** — only the cohort query.
**Blocked on:** nothing. Pure calculation.

### 5. Chef churn and first-shift retention

"Chefs at risk" is a snapshot of who has gone quiet. There is no monthly in/out flow, no
"what share of new chefs work a second shift", no time-to-first-shift. All the data is in
`chefs` + `placements` + `shift_hours`.
**Blocked on:** nothing. Pure calculation.

### 6. Booked-but-not-yet-earned revenue (the pipeline)

Every money figure is backward-looking and only starts counting once hours are
admin-approved. There is no "already booked for the coming 30 days"
(`future shifts × headcount × client_rate × duration`), no intake→shift conversion in euros,
and no forecast-vs-actual — because no forecast is ever stored, so deviation is by definition
unmeasurable.
**Booked figure BUILT (2026-07-27):** `getKpiBaselines().bookedRevenue` — committed
(`open`/`filled`) shifts in the next 30 days × headcount × client rate × duration (negative
durations guarded to 0); shifts without a rate count as €0 and are surfaced as a count. Forecast-vs-actual still needs a stored forecast.

### 7. Real contribution margin

Needs an employer-charges percentage and actually-paid travel reimbursement as stored data.
**Blocked on:** a product decision — these are settings, not calculations.

### 8. Cash: outstanding invoices, DSO, ageing

"Nog te factureren" exists; nothing after invoicing does.

### 9. Chef utilisation per chef

**The most expensive gap, and it is a data gap, not a calculation gap.** Utilisation needs
offered capacity, and `chef_availability` stores only blocked dates — and holds **zero rows in
production**. Until chefs declare "I am available for N shifts this week", every utilisation
figure is a platform-level estimate built on the 32-hour assumption.

---

## Where the numbers surface

| Surface | Shows |
| --- | --- |
| `/admin/business/reporting` | richest: trends per week/month, planner + relationship KPIs, leaderboards, revenue per klant/chef |
| `/admin/business/insights` | money, occupancy, capacity estimate, leaderboards |
| `/admin/business/overpromise` | promised vs delivered per klant (90d) |
| `/admin/planning` | demand forecast, roster KPI strip |
| `/admin/system` | AI usage + daily budget |
| `/client` | four tiles for the klant |
| AI tools | ~a dozen read tools over the same read-models, plus three PDF reports |
| Chef portal | **nothing** — chefs see no numbers about themselves |
