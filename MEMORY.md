# MEMORY.md — de staat van het systeem

**This file owns:** what is true about the deployed system *right now* — environments, which
flags are on in production, the invariants you must not break, what is known-broken, and what
is waiting on a decision.

**It does not own:** history (→ [docs/history/PR-LEDGER.md](docs/history/PR-LEDGER.md)) ·
counts (→ [docs/STATE.generated.md](docs/STATE.generated.md)) · how the AI works
(→ [AI.md](AI.md)) · step-by-step flows (→ [WORKFLOW.md](WORKFLOW.md)) · the rules an agent
must follow (→ [CLAUDE.md](CLAUDE.md)).

If you are about to type a number into this file, it belongs in `STATE.generated.md`.
If you are about to describe something that shipped, it belongs in the PR ledger.

---

## State right now

_Last verified against production: 2026-07-26._

| | |
| --- | --- |
| Prod DB branch | `ep-icy-scene` (Neon, eu-west-2) |
| Dev DB branch | `ep-green-mouse` |
| Hosting | Vercel (web) · Railway (`workers/supervisor.ts`) |
| Migration head on `main` | see [STATE.generated.md](docs/STATE.generated.md#schema) |
| Roster in prod | 8 matchable chefs (7 active + 1 onboarding), 3 archived |
| AI model | `gpt-5.4`, fallback `gpt-4.1-mini`, budget 25/day |
| 2FA | `TOTP_ENFORCE=true` |

**Waiting on a person, not on code:**

1. **Migration `0076_ai_memory_proposals` is not applied to prod.** The table does not exist
   (verified 2026-07-26). `AI_MEMORY_MINING_ENABLED` cannot be flipped until it is.
2. **`RESEND_INBOUND_SECRET`** — needs setting on the Resend dashboard webhook.
3. **OpenAI key rotation** — a test key was once exposed in chat. After rotating, update
   Vercel + Railway + local `.env.local`.

---

## Feature flags in production

Verified by pulling the production environment on 2026-07-26. This table is the *only*
authoritative statement of prod flag state — code defaults tell you nothing, because an unset
flag is off and most of these are `.optional()` with no default.

**ON in prod**

`AI_ENABLED` · `AI_SHORTLIST_ACTIONS_ENABLED` · `AI_WATCHDOG_ENABLED` · `BOARD_ENABLED` ·
`CHEF_OPEN_SHIFTS_ENABLED` · `CHEF_WHATSAPP_ENABLED` · `CLOCKOUT_DIGEST_ENABLED` ·
`COMPLIANCE_HARDGATE_ENABLED` · `CV_AI_PROFILING_ENABLED` · `DND_DURING_SHIFT_ENABLED` ·
`EMERGENCY_CLAIM_ENABLED` · `EMERGENCY_MODE_ENABLED` · `MATCHING_FAVORITES_ENABLED` ·
`MATCHING_MARGIN_GUARD_ENABLED` · `MATCHING_PREFS_ENABLED` · `OFFER_EXPIRY_SWEEP_ENABLED` ·
`ONBOARDING_NUDGE_ENABLED` · `PLANNER_AI_ENABLED` · `SHIFT_REMINDERS_ENABLED` ·
`SHIFT_SIGNALS_ENABLED` · `WEB_PUSH_ENABLED`

**DARK in prod** (declared in `src/lib/env.ts`, never set → off)

| Flag | What stays off | Notable? |
| --- | --- | --- |
| `I18N_ENABLED` | the whole NL/EN layer | **yes** — the newest large surface in the repo is not live |
| `MATCHING_TAGS_ENABLED` | skill-tag scoring | moot anyway: no prod chef has skill tags |
| `MATCHING_RELIABILITY_ENABLED` | no-show / reliability scoring | the data exists; the signal is unused |
| `KPI_FORECAST_ENABLED` | the 48-hour forecast card | |
| `CHEF_AI_CHAT_ENABLED` | the chef-portal assistant | |
| `ARRIVAL_TRUST_ENABLED` | arrival-trust signals | needs an AVG/DPIA call first |
| `CLOCK_OUT_RECOVERY_ENABLED` · `MONEY_EXPLAINER_ENABLED` · `REMINDERS_ENABLED` · `REPLACEMENT_HANDOVER_ENABLED` | | |

Eight further `*_ENABLED` flags are read straight off `process.env` and are **not** in the zod
schema, so a typo in one fails silently — listed in
[STATE.generated.md](docs/STATE.generated.md#feature-flags).

---

## Known broken / drift

| What | Detail | Status |
| --- | --- | --- |
| Chef search | `chefs.find` threw on every non-empty query (`text[] ~~* unknown`). Prod audit over 60 days: 11 failures to 2 successes. | **fixed on `docs/system-rebuild`**, not yet merged |
| Chef embeddings | 0 of 8 prod chefs have one, so `chefs.semantic_search` returns an empty set for every query (`WHERE embedding IS NOT NULL`). The `embedding-refresh` worker runs nightly. | open — worker output unverified |
| Availability data | `chef_availability` has **0 rows** in prod. "No row = available", so nothing is ever excluded and "wie kan zaterdag?" cannot be answered. | open — a data/product problem, not a code one |
| "Filled" means three different things | `platform-rollups.ts` (confirmed+completed, capped) · `metrics-snapshot.ts` (confirmed+completed, **uncapped** → `filled_slots` can exceed `slots_count`) · `demand-forecast.ts` (confirmed only, capped). | open — blocks any fill-rate KPI |
| Migration bookkeeping ≠ DDL | Dev recorded `0073` as applied but lacked its column; prod is missing `0076`'s table. Record counts prove nothing — verify via `information_schema`. | dev repaired; prod pending |
| Cron double-trigger | `clockout-digest` and `shift-reminders` fire from Railway *and* Vercel. Harmless only because both routes are idempotent. | accepted — keep them idempotent |
| `CLAUDE.md` rating rule | says `ratingCount≥5`; code says `3` (`src/lib/rating-tags.ts`). | fix CLAUDE.md |

---

## Critical invariants

**Security**

1. `TOTP_ENFORCE=true` is live. Every internal user with `totp_enabled` gets a 12h device
   cookie; the v2 format carries `enrolledAtMs`, so an admin reset invalidates every device
   cookie on the next request.
2. Password reset bumps `permissions_version` → invalidates the JWT on other devices.
3. 2FA reset bumps `permissions_version`, wipes the secret and the recovery codes, and sets
   `totp_enrolled_at = null` (which kills v2 cookie validation).
4. Recovery intents are purpose-bound: a forgot-password token cannot be used for lost-2FA,
   or vice versa. Single-use, atomic via `UPDATE … WHERE consumed_at IS NULL`.
5. **Auth IS the lookup.** No chef/client id ever comes from form data — resolve the entity
   from `session.user.id → entity.userId`.
6. State transitions are atomic: `UPDATE … WHERE id = ? AND status = '<expected>'`. Zero rows
   updated means the request was stale — reject it.

**Operational**

1. No external API call inside a business mutation. Approve hours → DB update + outbox
   enqueue; a worker delivers.
2. Idempotency key on every outbox row: same `(eventType, entityId, action)` → same key, so
   re-enqueueing is a no-op.
3. Append-only after export. Once `shift_hours.status = 'exported'`, only
   `shift_hour_corrections` may change it.
4. External system ids live in `external_refs`, never on entity tables.
5. Every email send creates an `email_messages` row; the Resend webhook updates its status.
6. No raw backend statuses in the UI — pipe through `humanStatus()` / `getClientShiftLabel()`.

---

## Open questions

Decisions that need a person. Resolved ones move to the PR ledger.

1. **Payingit API spec** — not publicly documented. CSV export first; live API when they give
   us docs.
2. **Accounting platform** — Exact / Moneybird / AFAS? The adapter pattern supports any.
3. **Legal text for the AVG modals** — placeholders + TODO; a lawyer fills these in.
4. **Cancellation severity thresholds** — 48h/24h/same-day in
   `src/lib/cancellation-severity.ts`; tune after a month of real use.
5. **iOS/Android calendar-subscription UX** — needs a manual test on a real device.
6. **How do matching attributes get filled?** No intake path writes `vakniveau`, `skillTags`,
   rate, radius or geo. Chef self-declares, admin sets at intake, or CV extraction
   auto-applies? This blocks any richer matching.
7. **Does a hard requirement exclude or only demote?** Today `minExperience` and
   `languageRequired` do neither — they append a warning with no effect on rank.

### Low-priority follow-ups

- `/client/templates` over-fetches `shift_template_exceptions` with no where-clause to build a
  lookup map. Only the caller's own templates render, so there is no cross-tenant exposure.
- `client_submissions` has no `clientId` FK on older rows; portal scoping falls back to
  matching `companyName`. Not an IDOR, but two clients with the same name would collide.

---

## How to update this file

Do **not** append a row here after every PR — that is what turned this file into 204KB of
unreadable ledger while the state sections rotted.

1. Always: append one line to [docs/history/PR-LEDGER.md](docs/history/PR-LEDGER.md).
2. Always: run `npm run docs:state` and commit the regenerated file.
3. Only when a **fact about the world changed** — a flag flipped on prod, an open question
   answered, an invariant added, something newly known-broken — edit the relevant section
   here and re-date "Last verified".

One fact per line, ~300 characters max. If a fact already lives in another doc, link to it.
