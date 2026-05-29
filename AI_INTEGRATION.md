# Chef & Serve — AI integration prep

> Living document. **Update this whenever a new phase ships** so when we wire AI into the system (Phase 9+), every data source, operation, and decision-point is already catalogued. No archaeology needed.

**Status:** Phase 0 complete. AI layer not yet wired. This doc plans the surface so we build correctly *now* and bolt the model on *later*.

**Related docs:**
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — tactical Phase 0 detail
- [`ROADMAP.md`](./ROADMAP.md) — 12-week strategic roadmap (AI = Phase 9+)

---

## Table of contents

1. [Why this doc exists](#1-why-this-doc-exists)
2. [The 4-layer AI architecture we're building toward](#2-the-4-layer-ai-architecture-were-building-toward)
3. [Data inventory — what lives where](#3-data-inventory--what-lives-where)
4. [RAG corpus — what we'll index](#4-rag-corpus--what-well-index)
5. [Tool surface — what the agent can DO](#5-tool-surface--what-the-agent-can-do)
6. [Decision-points where AI adds value](#6-decision-points-where-ai-adds-value)
7. [Engineering rules to keep AI-friendly](#7-engineering-rules-to-keep-ai-friendly)
8. [Privacy, safety, audit](#8-privacy-safety-audit)
9. [Phased AI rollout plan](#9-phased-ai-rollout-plan)
10. [Open questions](#10-open-questions)

---

## 1. Why this doc exists

We're building a closed-system staffing platform. The point isn't to be *another* CRM — it's that **Maarten's network of 200+ premium chefs is matchable in ways generic SaaS can't do**: vakniveau × segment × stijl × historical performance. That match logic is the moat.

Phase 1-8 ships the operational scaffolding (intake → roster → hours → payroll). Phase 9+ is when AI starts taking decisions:

- *"Given this client request, which 3 chefs should Maarten propose?"*
- *"This chef cancelled 3 weeks in a row — flag for a check-in."*
- *"Next month is school holidays — you're under-staffed for breakfast chefs."*
- *"This chef is being underpaid relative to their accept-rate and rating — recommend raising tariff."*

For that AI layer to work, three things need to exist *now*, while we're still building Phase 1:

1. **Structured data with stable identifiers** — every entity an embedding can point at
2. **A clean operation log** — for retrospective learning ("when this match worked, what was different?")
3. **Tools the AI can call** — server actions / API routes the model can invoke, gated by RBAC

This doc tracks all three across every phase.

---

## 2. The 4-layer AI architecture we're building toward

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 4 — AGENT / COPILOT                                       │
│  ────────────────                                                │
│  • Maarten's chat-style copilot in /admin                        │
│  • Reads context (current request, chefs, history)               │
│  • Calls TOOLS (layer 3) to act                                  │
│  • Citing sources from RAG (layer 2)                             │
│  • Routed via OpenAI / Claude / open-source LLM                  │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3 — TOOLS (function-calling surface)                       │
│  ────────────────                                                │
│  • Read tools: searchChefs, getShift, getClientHistory, …        │
│  • Write tools: proposePlacement, approveHours, …                │
│  • All gated by current user's RBAC permissions                  │
│  • All actions audit-logged                                      │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2 — RAG (retrieval-augmented context)                     │
│  ────────────────                                                │
│  • Vector index of: chef profiles, client briefings,             │
│    historical placements, ratings, comm history                  │
│  • Stored in Neon pgvector (no extra service)                    │
│  • Reindexed nightly (Railway cron)                              │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 1 — STRUCTURED DATA (source of truth)                     │
│  ────────────────                                                │
│  • Neon Postgres tables — chefs, clients, shifts,                │
│    placements, hours, ratings, audit_log                         │
│  • Drizzle schema with stable UUIDs                              │
│  • The contract we make to ourselves: AI never invents           │
│    facts not present here                                        │
└──────────────────────────────────────────────────────────────────┘
```

**Anti-goal:** an AI that hallucinates chef availability or invents pricing. The whole point of layers 1+3 is that the model can only *suggest*, never *invent* — every fact comes from DB, every action goes through a typed tool.

---

## 3. Data inventory — what lives where

Catalog of every entity. Each row says: *which table*, *which fields the AI cares about*, *which phase ships it*.

### Phase 0 (DONE)

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `users` | `id`, `email`, `name`, `kind`, `status`, `roles` | Determines who can call which tool. AI inherits caller's RBAC. |
| `roles`, `permissions`, `role_permissions`, `user_roles` | Permission graph | Gates AI tool access. |
| `audit_log` | `user_id`, `action`, `resource`, `resource_id`, `before/after`, `created_at` | Training signal — "what did Maarten do after the AI suggested X?". Also the AI's *own* actions go here. |
| `error_log` | `message`, `stack`, `context`, `severity`, `created_at` | The AI can read this to help debug ("we had 12 webhook failures last hour, here's the pattern"). |
| `webhooks_received` | `source`, `payload`, `processed_at`, `processing_error` | Pre-Phase-1 stub — populated once Jotform webhooks ship. |

### Phase 1 — Jotform intake (next up)

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `chef_submissions` | `raw_payload`, structured fields (name, phone, role wishes, segments, availability hints, years of experience, languages) | Initial signal pool. Pre-AI heuristics for "looks promising" flagging. |
| `client_submissions` | `company`, `role_requested`, `segment`, `date_needed`, `headcount`, `urgency`, `notes` | The natural-language ask → AI parses + structures + matches. |

### Phase 2 — Chef + client master records

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `chefs` | `vakniveau`, `segments[]`, `specialties[]`, `locatie` (point), `hourly_rate_min/max`, `years_experience`, `languages`, `payingit_employee_id`, `status`, `joined_at` | The candidate pool. Embeddings live here. |
| `chef_availability` | `chef_id`, `date`, `available`, `notes` | Hard filter — AI never proposes someone unavailable. |
| `chef_documents` (R2 metadata) | `chef_id`, `type` (cv/cert/photo), `r2_key`, `uploaded_at` | RAG fodder — chef CVs go into the vector index. |
| `clients` | `company_name`, `segment`, `kvk`, `payment_terms_days`, `payingit_client_id`, `notes`, `address`, `joined_at` | Match destination. Embeddings live here too. |
| `client_locations` | `client_id`, `address`, `geo` (point), `kitchen_notes` | Multi-location clients (hotel groups). Distance-based ranking. |

### Phase 3 — Shifts + placements + matching

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `shifts` | `client_id`, `location_id`, `date`, `start_time`, `end_time`, `role`, `segment`, `headcount`, `hourly_rate`, `status`, `created_at`, `notes` | The "ask". Vectorize the notes for semantic similarity. |
| `placements` | `chef_id`, `shift_id`, `status` (proposed/accepted/rejected/confirmed/no_show/completed), `proposed_at`, `confirmed_at`, `completed_at`, `proposed_by`, `notes` | **The training signal.** Every (chef, shift, outcome) triplet is gold for the matching model. |
| `match_scores` (Phase 9) | `shift_id`, `chef_id`, `score`, `model_version`, `features (jsonb)`, `created_at` | AI's own outputs, audited. |

### Phase 4 — Chef portal (interaction signals)

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `chef_actions` | `chef_id`, `action` (offer_viewed/accepted/declined/cancelled), `shift_id`, `response_time_seconds`, `created_at` | Behavior signal — quick acceptors, frequent decliners, cancellation patterns. |

### Phase 5 — Hours + Payingit

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `hours` | `placement_id`, `hours_worked`, `break_minutes`, `submitted_at`, `approved_at`, `discrepancy` (computed) | Reliability signal — chefs who claim consistently match scheduled hours are golden. |

### Phase 6 — Client portal

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `ratings` | `client_id`, `chef_id`, `placement_id`, `stars` (1-5), `comment`, `created_at` | The other half of the training signal. Stars feed match scoring. Comments feed embeddings (sentiment). |

### Phase 7 — Communications

| Table | AI-relevant fields | Why AI cares |
|---|---|---|
| `messages` | `from`, `to`, `channel` (email/sms/whatsapp), `template`, `payload`, `sent_at`, `opened_at`, `clicked_at` | Engagement signal — which chefs read mails, click links, ignore? |
| `notes` (free-text Maarten-only) | `subject` (chef_id / client_id / shift_id), `body`, `author_id`, `created_at` | Maarten's tribal knowledge — *"avoid scheduling Pieter with Wim, they had a fight in 2024"*. RAG-indexed. |

---

## 4. RAG corpus — what we'll index

When we wire Phase 9 RAG, these become vectorized chunks. Using **Neon's pgvector extension** (no extra service required) and OpenAI embeddings (cheapest accurate option as of mid-2026).

Index categorisation:

| Corpus | Source | Update freq | Chunk strategy |
|---|---|---|---|
| **Chef profiles** | `chefs` + `chef_documents` (CVs) | Nightly (on change) | One vector per chef. Include CV text + Maarten's notes. |
| **Client briefings** | `clients` + `client_locations` + `notes(subject=client)` | Nightly | One vector per client. Kitchen style, expectations, payment behaviour. |
| **Shift descriptions** | `shifts.notes` + nearby chef-comments | Per-shift | Semantic search "find similar past shifts". |
| **Placement outcomes** | `placements` joined with `ratings` + `hours.discrepancy` | Nightly | "Find shifts like this one — which chefs succeeded?" |
| **Maarten's notes** | `notes` (free-text) | On write | The tribal-knowledge corpus. Highest signal density. |
| **Email/WhatsApp threads** | `messages` (Phase 7+) | On write | "What was last said to this chef?" |

**What we DO NOT index:**
- BSN, bank details, passport scans — sensitive, no model needs them
- Audit-log payloads — too noisy
- Error stacks — solved problem if not personally identifying

**Storage cost projection** (rough): ~10MB vector data per 1000 chefs+clients+shifts. Negligible on Neon Launch tier.

---

## 5. Tool surface — what the agent can DO

When we build the AI copilot (Phase 9+), it gets a typed function-calling interface. Every tool is:

1. A real server action / API route — same code humans use
2. Gated by the *caller's* RBAC — AI inherits, never escalates
3. Audit-logged with `audit_log.user_id = <human caller>` + `audit_log.action = "ai.<tool>"`

The catalogue we're building toward:

### Read tools (Phase 9 launch)

```ts
searchChefs({
  vakniveau?: string,        // 'sous_chef' | 'chef_de_partie' | …
  segments?: string[],       // ['fine_dining', 'banqueting']
  availableOn?: Date,
  locationWithin?: { lat, lng, km },
  rateMaxEur?: number,
  freeText?: string,         // semantic search via RAG
}): Chef[]

getChef(chefId): Chef + recent placements + average rating + availability calendar

searchClients({ segment?, freeText? }): Client[]

getClientHistory(clientId): { placements[], total_spend, ratings_given, last_active }

getShift(shiftId): Shift + proposed/confirmed placements + status

findSimilarShifts(shiftId): Shift[]  // RAG semantic match

getRecentAuditLog({ resource?, userId?, since?, limit? }): AuditEntry[]
```

### Write tools (Phase 9-10, gated by role)

```ts
proposePlacement(shiftId, chefId, { reasoning }): Placement  // creates 'proposed' status
                                                              // sends Resend notification
sendShiftOffer(shiftId, chefIds[]): { sent: number }

updateShift(shiftId, patch): Shift   // bookkeeper/coordinator/owner only

approveHours(placementId): Hours     // coordinator/bookkeeper only

addNote({ subjectType, subjectId, body }): Note    // any authed user

flagChefForReview(chefId, reason): void   // creates audit entry + admin notification
```

### Maarten-only tools (Phase 10+)

```ts
suggestRoster(weekStart: Date): RosterSuggestion   // bulk match suggestions
                                                    // with confidence per row
predictDemand(weeksAhead: number): DemandForecast

flagChefAtRisk(): Chef[]                            // churn-risk predictions

suggestTariffAdjustment(chefId): TariffSuggestion
```

### Tools we'll deliberately NOT build (safety)

- **No tool that bypasses Maarten for sensitive comms.** AI can draft, never send unattended.
- **No financial tool that moves money.** Payingit handles payroll; AI is read-only on hours+invoices.
- **No tool to disable/delete a user.** That's manual + audit-trailed.
- **No tool that talks to Payingit directly.** Only humans + scheduled crons hit Payingit.

---

## 6. Decision-points where AI adds value

Locations in the flow where the AI copilot can save Maarten time. **Each must be tracked as a feature flag** so we can A/B against "Maarten alone" baseline.

| Phase | Decision | AI offers | Human keeps |
|---|---|---|---|
| 1 | New chef intake reviewed | Auto-extract structured fields from raw Jotform payload | Maarten approves/edits |
| 1 | New client request reviewed | Suggest urgency level + segment based on free-text | Maarten approves |
| 3 | Client request → chef match | Top 5 ranked candidates with reasoning | Maarten picks + sends |
| 3 | Shift hits "open" state for >24h | Suggest tariff bump OR widen segment filter | Maarten decides |
| 4 | Chef hasn't logged in for 30 days | Draft check-in email | Maarten edits + sends |
| 4 | Chef cancellation pattern detected | Flag for follow-up call | Maarten makes the call |
| 5 | Hours discrepancy detected | Draft message to chef asking clarification | Maarten reviews before send |
| 6 | Client rating < 3 stars | Draft apology + suggest next chef | Maarten approves/edits |
| 9 | Roster generation for next week | Full auto-suggest with confidence per slot | Maarten approves/edits |
| 9 | Demand forecast | "You'll be short 4 sous chefs in week 28" | Maarten plans recruiting |

---

## 7. Engineering rules to keep AI-friendly

Things to bake in *now* so AI integration in Phase 9 isn't a rewrite:

### Schema discipline

- ✓ **Stable UUIDs everywhere.** Chefs, clients, shifts, placements all have permanent IDs. Embeddings will reference these.
- ✓ **Enums over free text** for status fields. `placement.status='confirmed'` is RAG-friendly; `placement.status='it went well'` isn't.
- ✓ **`created_at` + `updated_at` on every table.** AI needs time series. *(Drizzle defaults already enforce this.)*
- ✓ **Soft-delete** (`deleted_at`) instead of hard delete on chefs/clients/shifts. Historical data is training data.
- ☐ **JSONB notes columns are OK but indexed text columns are better.** When something becomes structured (e.g. `chef.specialties`), promote it from JSON to a proper column or join table.

### Operation discipline

- ✓ **Every mutation goes through a server action.** No direct `db.update().where()` in components. Server actions are the tools AI will eventually call.
- ✓ **Every mutation writes to `audit_log`.** No silent state changes. *(Will be enforced via a `withAudit()` wrapper in Phase 1.)*
- ☐ **Idempotency keys on write endpoints.** Phase 1: webhook receivers need this. Prevents AI double-clicks → double placements.
- ☐ **Versioned outputs.** If AI generates a roster, store `model_version` + `features` so we can compare runs.

### Code organisation

```
src/
├── lib/
│   ├── db/                    Drizzle schema, client, seed
│   ├── domain/                # NEW — Phase 1+
│   │   ├── chefs.ts          Pure functions: findChefs, getChef, etc.
│   │   ├── clients.ts
│   │   ├── shifts.ts
│   │   ├── placements.ts
│   │   └── matching.ts       The matching logic (rule-based v1, AI-augmented v2)
│   ├── tools/                 # NEW — Phase 9
│   │   ├── definitions.ts    OpenAI / Claude function-calling JSON schemas
│   │   └── handlers.ts       Maps tool calls → domain functions (with RBAC)
│   ├── auth.ts
│   ├── permissions.ts
│   └── env.ts
└── app/
    └── api/
        └── ai/                # NEW — Phase 9
            └── chat/route.ts  Agent endpoint (streams LLM responses)
```

The `lib/domain/` boundary is critical. Every "verb" the system supports is a function in `domain/`. UI and AI both call the same function. No "AI version" of `findChefs` — there's one `findChefs`, called by both.

---

## 8. Privacy, safety, audit

### What the AI sees

- All data inside Layer 1 that the *caller's* RBAC allows. Owner-role calls see business data; chef-role calls see only own data.
- RAG returns sanitized chunks — never raw email addresses or BSNs in retrieval results.

### What the AI never sees

- BSN (encrypted at rest, never decrypted unless caller is super_admin doing payroll work — and even then via a dedicated function, not via AI)
- Bank account details
- Identity documents (we store R2 paths, AI gets "uploaded_at" + "type" only)
- Other tenants' data (N/A — closed system, single tenant)

### Prompt-injection defense

- Chef notes, client notes, free-text payloads = **untrusted input**. Never inject directly into system prompts.
- We use the **per-role tool-use restriction**: even if an attacker tricks the AI into calling `approveHours()`, it'll be rejected by RBAC if the caller is a chef, not a bookkeeper.
- AI cannot read its own audit log to manipulate it — `audit_log` is append-only at the DB level.

### AI actions are audit-logged distinctly

`audit_log.action = "ai.proposePlacement"` (vs. `"placements.create"` for a human). So if Maarten audits "show me everything Lisa did Friday", AI-suggested-then-approved actions are differentiated from pure manual.

**"Who really did it" is now first-class.** `audit_log.impersonator_user_id`
(migration 0032) records the real super_admin behind a human **Bekijk als**
session; every impersonated write also carries `after._imp = <session id>`, so
one SQL query returns a whole session (start → writes → stop). The future AI PA
acts under its OWN service identity and records `after._pa = { requestedBy,
target, reason, tool }`. Canonical writers live in `src/lib/audit.ts`
(`recordAuditCore` pure / `recordAuditFromRequest` request-scoped). Full model:
`docs/ai/ai-pa-access-model.md`; correlation detail:
`docs/ai/ai-audit-and-logging.md`.

---

## 9. Phased AI rollout plan

Loosely mapped to `ROADMAP.md`:

| Step | Phase | What we add | Risk |
|---|---|---|---|
| **A** | Phase 1+ | Heuristic match scoring (no LLM yet). Pure SQL: `vakniveau match × segment overlap × distance × availability`. Returns top 8 chefs for a shift. | Low — deterministic, debuggable. |
| **B** | Phase 3 | Surface heuristic ranking in admin UI. Maarten clicks "Suggest chefs". A/B against "no suggestions" to verify match quality. | Low. Maarten still picks. |
| **C** | Phase 6 | Embed chef/client profiles + notes into Neon pgvector. RAG-powered semantic search: "find me chefs like the ones I picked last December for Lute". | Low — read-only. |
| **D** | Phase 9 | Phase-1 LLM copilot: function-calling chat in admin. Read-only tools first (no writes). Maarten can ask questions, AI cites sources. | Medium — needs eval against real questions. |
| **E** | Phase 10+ | Write tools (proposePlacement, sendShiftOffer). AI drafts, Maarten approves every send for first 2 months. | Medium — staged rollout per tool. |
| **F** | Phase 11+ | Auto-actions where confidence is very high (e.g. shift offer to top 3 chefs). Still audit-logged + reversible. | Higher. Per-tool kill switch via feature flag. |

**Never auto-action:** financial transactions, contract changes, communications that change the legal relationship.

---

## 10. Open questions

Things to revisit at the start of Phase 9 (or sooner if a decision changes our schema):

1. **Embedding model — open vs. proprietary?**
   OpenAI's `text-embedding-3-small` is cheap (~$0.02 per 1M tokens) and accurate. Open-source alternatives (e.g. `bge-large-en-v1.5`) need self-hosting. Neon pgvector is provider-agnostic — switch later if needed.

2. **LLM provider — single or multi?**
   Routing per-task makes sense: Claude for long reasoning, GPT-4o-mini for routine extraction. Phase 9 can start with one, add the second once we know which tasks need which.

3. **Where does AI run — Vercel edge, Railway, or hybrid?**
   - Short chat completions on Vercel functions (low latency)
   - Long batch jobs (embedding reindex, demand forecast) on Railway crons
   - Same code via shared `lib/domain/`

4. **Eval harness?**
   By Phase 9 we'll need a "golden set" of past Maarten matches (Phase 3 collects them automatically). Each AI iteration is evaluated on those before shipping.

5. **Multi-language?**
   Maarten thinks in Dutch + English. Chefs span 6+ languages. Embeddings should be multilingual-capable from day one.

6. **Knowledge cutoff problem?**
   Models trained before 2026 don't know about Wet DBA 2026 specifics, Payingit's umbrella role, etc. Anything time-sensitive goes in RAG, not in training context.

---

## Maintaining this doc

This is a **living document**. Update it:

- ✅ Every time we add/modify a table → update §3 "Data inventory"
- ✅ Every time we add a write operation → update §5 "Tool surface" (even if AI won't call it for months)
- ✅ Every time we ship a phase → cross off any AI-relevant todos here
- ✅ Every decision about model/provider/architecture → add to §10

Goal: when we land in Phase 9 and start wiring AI, this doc is the brief. Zero archaeology.

---

**Last updated:** Phases 0 → 7 + AVG + cockpits shipped. Business + system +
**roster** (Day/Week/Maand control tower) cockpits live; human write-impersonation
("Bekijk als") live + audited (migr 0032); high-risk mutation+audit now same-tx
atomic (`withTx`). AI-PA access model specced (`docs/ai/ai-pa-access-model.md`).
Phase 5 (Payingit) blocked on integration spec. AI copilot layer = Phase 9+.

### Data inventory status (vs. plan)

| Table | Plan phase | Status |
|---|---|---|
| users · roles · permissions · role_permissions · user_roles | Phase 0 | ✓ live |
| audit_log · error_log · webhooks_received | Phase 0 | ✓ live |
| chef_submissions · client_submissions | Phase 1 | ✓ live (idempotent on (source, external_id)) |
| chefs · clients · chef_availability | Phase 2 | ✓ live (soft-delete via deleted_at) |
| shifts · placements | Phase 3 | ✓ live (with vakniveau/segment/shift_status/placement_status enums) |
| chef_documents (R2 metadata) | Phase 2 polish | DEFERRED (needs R2 creds) |
| chef_actions (engagement signal) | Phase 4 | DEFERRED (Phase 7 polish) |
| hours | Phase 5 | NOT YET (Phase 5 schema lands with Payingit work) |
| ratings | Phase 6 polish | NOT YET |
| messages (Resend tracking) | Phase 7 | NOT YET |
| match_scores (AI outputs) | Phase 9 | NOT YET — placements.match_score column already in place for heuristic v1 |

### Tool surface status

Phase 3 already exposes `findMatchesForShift()` + `proposePlacement()` as the
matching primitives. Same function signatures will be the Phase 9 AI tool
surface — UI/admin calls them today, future AI will call the same.

Conversion primitives shipped in Phase 2: `convertChefSubmission()` +
`convertClientSubmission()`. Already audit-logged with stable action keys.

**Cockpit + impersonation (this phase).** `/admin/business` (business cockpit)
and `/admin/system` (system cockpit) expose read primitives — `dashboard-intel`,
`system-intel`, `/api/health`, usage — that become the cockpit/system AI tools.
The `/admin/business/roster` **control tower** (Day/Week/Maand) is built the same
way: one pure engine `domain/roster-intel` (`buildRosterView` + `rosterAiSummary`)
that the page renders from AND the AI reads, so screen and AI never drift. It is
**read + navigate** (KPIs are clickable filters; every CTA links to the shift/chef
detail page) — the interactive *solving* surface (assign/propose/publish) is the
future `/admin/business/planner` (**Rooster ≠ Planner**). Locked active-fill rule:
gevuld = confirmed ≥ headcount; `completed` is past-only and never inflates a future
shift. Deferred (no faked signals): publish-state badges, trend/forecast (need
history snapshots + a demand model), saved views, financial-lock warning (the
`hoursApproved`/`payrollLocked` fields exist on the row type as forward-compat).
Human **write-impersonation** ("Bekijk als") is live: a super_admin can act as
any chef/klant/owner; every write is audited as the impersonator, with a verified
destructive denylist (`src/lib/impersonation-denylist.ts`) +
`assertImpersonationAllowed()` action guard. New tool contracts:
`docs/ai/tool-contracts/{cockpit,roster,system,impersonation,matching,profile-data-request,client-taxonomy}-tools.md`.
The AI-PA access model (own service identity, NOT impersonation) is specced in
`docs/ai/ai-pa-access-model.md` so the PA isn't blocked when it lands.
