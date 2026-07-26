# AI.md — de assistent van Chef & Serve

> **Voor Maarten, in het kort.** De assistent is een chat die antwoordt uit de database en
> handelt via dezelfde knoppen als de schermen. Hij verzint niets: elk feit komt uit een
> tabel, elke actie loopt door een vaste "tool". Alles wat naar buiten gaat — een mail, een
> voorstel aan een klant, iets met geld — vraagt eerst jouw bevestiging. Hij kan geen geld
> overmaken, geen gebruiker verwijderen en niets naar Payingit sturen.
>
> Engineering detail follows in English.

**This file owns:** how the AI layer works — architecture, safety mechanisms, runtime
behaviour, and its known gaps.
**It does not own:** counts (→ [docs/STATE.generated.md](docs/STATE.generated.md)), which flags
are on in production (→ MEMORY.md), per-tool contracts (→ [docs/ai/](docs/ai/)), or
step-by-step user flows (→ WORKFLOW.md).

It replaces `AI_INTEGRATION.md`, which was a pre-launch plan document. Present tense only:
if it is written here, it runs today.

---

## 1. In 30 seconds

- **What it is** — an agent loop over a registry of typed tools. The tools are the same
  domain functions the UI calls, so the assistant cannot do anything a screen could not.
- **The rule that makes it safe** — the model can only *suggest*, never invent. Every fact
  comes from the DB, every action goes through a typed tool, every risky action needs a human.
- **What it never does** — move money, delete or disable a user, touch Payingit, or send
  anything outbound without a human pressing confirm. These are absent by construction: there
  is no tool for them.
- **One brain** — OpenAI only. `src/lib/ai/runtime/openai-brain.ts` posts to
  `api.openai.com/v1/chat/completions`. The only "fallback" is a second OpenAI model.

## 2. The four layers

```
  Layer 1  structured data     the tables the read-models query
  Layer 2  retrieval           two separate vector stores (§6)
  Layer 3  tools               the only way anything happens
  Layer 4  the agent loop      plan → run tools → plan again → answer
```

## 3. Where you can talk to it

| Surface | Route | Who | Notes |
| --- | --- | --- | --- |
| Owner assistant | `POST /api/ai/chat` | owner · super_admin | `/admin/assistant` + floating widget |
| Planner | same | planner role | behind `PLANNER_AI_ENABLED`, scoped registry |
| Chef portal | `POST /api/ai/portal/chat` | chef | own data only, read-only |
| Klant portal | same | klant contact | own data only, read-only |

Supporting routes: `/api/ai/conversation` (cross-device resume), `/api/ai/feedback` (👍/👎),
`/api/ai/memory-proposals` (the "Onthoud dit" inbox), `/api/ai/shortlist/propose`.

UI lives in `src/components/ai/` — `AssistantChat` is shared by all three portals and
switches behaviour on its `endpoint` prop. **Owner-only chat features must gate on an
owner-channel-only response field plus a dedicated owner API route — never by importing
admin actions into the shared component.**

## 4. What happens between the question and the answer

### 4.1 Context injection
Before the model sees anything, the route assembles a **trailing** system message: the current
time block, the page path the user is on, the entity id resolved from that path, a planner
note, and the owner's memory. It is trailing on purpose — the static prefix (system prompt +
playbook + tool schemas) stays byte-stable so it is prompt-cacheable.

### 4.2 The page→entity trick
On `/admin/business/chefs/<id>` the model is handed that id directly, so it skips a name
lookup entirely. This is the cheapest latency win in the system and worth preserving.

### 4.3 The agent loop — `runtime/agent.ts`
- **Max 8 steps** (`maxSteps ?? 8`), i.e. up to 9 sequential model calls per question.
- Tool calls the model batches in one turn run **concurrently** via `Promise.all`.
- The loop **pauses** on the first `needs_confirmation` and returns to the human.
- History is capped at 60 messages.
- If the step budget runs out it makes one final **tools-less** call, so the model answers in
  words with what it gathered instead of dead-ending on "max steps reached".

### 4.4 `jsonForBrain` — element-aware truncation
Tool data is capped before it reaches the model. It drops **whole array elements** and tells
the model it saw a subset, rather than slicing mid-string into invalid JSON. That matters:
a naive char-slice makes the model silently under-report counts.

### 4.5 The playbook — `src/lib/ai/playbook.ts`
Maarten-tuned glossary, lifecycle, and a question→tool routing table, appended every turn.
**This is the main "make it smarter" lever** — behaviour changes here need no code change.

## 5. Tools

### 5.1 Naming
`resource.action` — `chefs.find`, `hours.approve`, `roster.autofill`. (The camelCase names in
the old `AI_INTEGRATION.md` — `searchChefs`, `proposePlacement`, `sendShiftOffer` — never
existed.)

### 5.2 Shape
```ts
defineTool({ name, title, description, risk, permission, input /* zod */, run })
  → { data, summary }   // summary is a Dutch sentence the model quotes back
```

### 5.3 Risk tiers
| Tier | Meaning | Confirm? |
| --- | --- | --- |
| `read` | no side effects | no |
| `self` | changes only the owner's own scratch state (memory, reminders) | no |
| `outbound` | something leaves the building — mail, a proposal to a klant | **yes** |
| `financial` | money or payroll | **yes** |

Counts per tier: [STATE.generated.md](docs/STATE.generated.md#ai-tools).

### 5.4 The permission ceiling
`runtime/actor.ts` gives the assistant the human's **effective permission set** — it can never
exceed the person driving it. super_admin gets the whole RBAC catalog. `buildScopedRegistry()`
filters the registry for non-owner roles so owner-only tools never reach the model at all.

> **The AI has no separate identity yet.** `actor.ts` sets `paServiceUserId = userId`, so every
> AI audit row is attributed to the human. A distinct service identity is a TODO, not a fact.

### 5.5 Portal tools are scoped by OWNERSHIP, not RBAC
Chef and klant tools are `permission: null` + `risk: "read"` and key every query off
`actor.subject.entityId` — never a model-supplied id. This is the same
**auth-is-the-lookup** rule the rest of the codebase follows.

### 5.6 The executor pipeline — `runtime/execute.ts`
Every call passes four gates in order:
```
zod validate input → RBAC permission ceiling → confirm gate → run + audit
```
A throwing tool is caught and returned as `{ status: "error" }` with a Dutch message. **This
is why a broken tool degrades into apologies instead of a crash** — and why one went unnoticed
for a long time (§10).

## 6. The confirm gate

For `outbound` and `financial`, the executor mints an **HMAC-SHA256 token** over the tool name
and input, returns `needs_confirmation` with a human-readable summary, and the human echoes the
token back. TTL **10 minutes**. `AI_CONFIRM_SECRET` must be ≥32 chars or it throws at boot.

Confirmed-action results are re-injected into the conversation so the model can chain onward
instead of losing the thread after a confirm.

## 7. What the assistant may see

### 7.1 Two vector stores — confusing them is the classic mistake

| | `ai_embeddings` | per-row `embedding` columns |
| --- | --- | --- |
| Holds | chunked notes/documents | whole-profile vectors on chefs, clients, shifts |
| Backs | `knowledge.search` | `chefs.semantic_search`, `clients.semantic_search` |
| Refreshed by | **Vercel** cron `/api/cron/rag-ingest` | **Railway** worker `embedding-refresh` |
| Model | `text-embedding-3-small`, dim 1536 | same |

The Vercel/Railway split is deliberate: Railway workers cannot import the shared redact/chunk
modules, so the ingest logic lives app-side.

> ⚠️ **Footgun.** `ai_embeddings` and the pgvector columns live in `drizzle/manual_*.sql`,
> **outside the migration journal**. A fresh Neon branch silently lacks them and nightly
> ingest fails every night without anyone noticing. See [docs/STATE.generated.md](docs/STATE.generated.md#schema).

### 7.2 Redaction and access
`redact()` runs at **index** time, not query time. `REDACTION_VERSION` forces a full reindex
when the rules change. `accessFilterFor()` becomes a WHERE clause on visibility + tenant scope;
k is capped at 20.

### 7.3 What the AI never sees
BSN, IBAN, identity-document numbers — labels and aggregates only, never values. The directory
read-model deliberately omits even email and phone (AVG data-minimisation); contact details come
from dedicated tools. The AI never reads `placements.notes` for klant-facing answers.

### 7.4 Prompt injection
Inbound email bodies, webhook payloads and chef/klant free text are **data, never
instructions**. RBAC and the confirm gate are the backstop: even a successful injection cannot
exceed the driving human's permissions or send anything without a human confirm.

## 8. Memory, conversations, feedback

- `memory.remember` / `list` / `forget` → per-user rows, injected into the prompt each turn.
- `reminders.*` → owner reminders in `business_settings`.
- `ai_memory_proposals` — mined from conversations, surfaced as a one-click "Onthoud dit"
  inbox. Gated by `AI_MEMORY_MINING_ENABLED`.
- `ai_conversations` — cross-device resume; cascades on user erasure.
- `ai_feedback` — 👍/👎 from all three surfaces. **Read by hand; drives nothing automatically.**

> Memory is a flat prompt bullet list. It reaches the *model*, not the *ranker* —
> `findMatchesForShift` never reads it. "Stuur Marco nooit naar Okura" will not remove Marco
> from a shortlist. See §10.

## 9. What it does without being asked

Every proactive job **proposes**. None of them sends or applies anything — there is no
auto-action path in the codebase.

| Job | Produces | Flag |
| --- | --- | --- |
| `ai-watchdog` | draft findings for review | `AI_WATCHDOG_ENABLED` |
| `onboarding-nudge` | in-app nudges only | `ONBOARDING_NUDGE_ENABLED` |
| `daily-briefing` | the morning briefing, idempotent per day | `business_settings` |
| `ai-memory-mining` | memory *proposals* | `AI_MEMORY_MINING_ENABLED` |
| `ai-preplan` | invisible concept placements | `AI_PREPLAN_ENABLED` |
| `cv-profiling` | staged profile suggestions needing accept | `CV_AI_PROFILING_ENABLED` |

Schedules: [STATE.generated.md](docs/STATE.generated.md#scheduled-work). All are thin Railway
tickers POSTing app-side routes.

## 10. Known gaps — what does not work today

Documented here because a doc that only lists strengths is not a reference.

**Chef search is the weakest part of the system.**

- `chefs.find` — the primary chef lookup — **throws on every non-empty query**.
  `read-model/directory.ts` runs `ilike()` against `chefs.segments`, a `text[]` column;
  Postgres answers `operator does not exist: text[] ~~* unknown`. The executor catches it, so
  it surfaces as an apology rather than an error.
- The admin chef directory search uses `like()` (case-**sensitive**) — `amsterdam` finds
  nothing, `Amsterdam` works — and searches only name/email/city.
- **The base ranking formula is three variables**:
  `score = vakniveau×0.5 + segment×0.3 + ervaring×0.2`, then multiplicative adjusters that are
  each behind a `MATCHING_*` flag. In production (verified 2026-07-26) `MATCHING_PREFS_ENABLED`,
  `MATCHING_FAVORITES_ENABLED` and `MATCHING_MARGIN_GUARD_ENABLED` are **on** — so travel
  radius, chef-avoid signals, klant favourite/block tiering and the margin guard *do* count.
  `MATCHING_TAGS_ENABLED` and `MATCHING_RELIABILITY_ENABLED` are **dark**, so skill tags and
  no-show/reliability history contribute nothing. (Skill tags would be moot anyway — no chef
  in production has any.) Flag state lives in MEMORY.md, never here.
- `minExperience` and `languageRequired` produce **warning strings with no effect on rank**,
  and a chef with no languages recorded silently passes a language requirement.
- The scorer quantises to ~60 distinct values and the candidate query has **no `ORDER BY`**,
  so large groups tie exactly and the "top 10" can differ between identical requests.
- The good ranker is only reachable with an existing `shiftId`. There is no tool that takes a
  free-text requirement. `scoreChefForShift(chef, ScorableShift)` is already pure, so this is a
  small gap to close, not a rewrite.
- Near-misses are computed and **discarded**, so "no match" dead-ends instead of saying which
  constraint to relax.

**The assistant is not fast.**

- **Nothing streams.** The route returns one JSON blob; the UI awaits `res.json()`. Time to
  first word equals total time, with an indeterminate spinner and no tool progress.
- Every model call re-sends the **entire** tool registry — there is no subsetting for the
  owner — plus the system prompt and playbook.
- A realistic chef question is 3-4 sequential model calls, each re-paying that prefix.
- No `reasoning_effort` is set. On a provider hiccup the fallback **replays the whole run**.

**We cannot measure any of it.**

- The eval suite scores **tool routing only** — `brain.plan` is called and no tool is ever
  executed, which is exactly why the broken `chefs.find` shipped green.
- **Zero** result-quality assertions: nothing checks which chefs come back or in what order.
- **Zero** latency instrumentation anywhere in `src/lib/ai/**`.
- The audit sink records the tool *name* but never its input or result set, so "which chefs did
  the assistant suggest" is **not in the database** and cannot be compared to what Maarten
  actually proposed.

## 11. Cost and resilience

- `AI_DAILY_BUDGET` is a hard ceiling with an 80% warning notification. Per-day/per-model token
  tallies live in `business_settings['ai_usage']`, pruned at 120 days.
- Built-in pricing per model with `OPENAI_PRICE_*` overrides. `maxCompletionTokens` 2000.
- Prompt caching is wired with a stable prefix + cache key — a real **cost** lever, but barely
  a latency one, and it goes cold between questions.
- **Circuit breaker** — 3 consecutive provider failures within 10 minutes opens it for 5
  minutes; chat answers with a friendly Dutch message and makes no OpenAI call. Fails *open*
  (a breaker bug can never take the assistant down).
- Retry with backoff on 429/5xx, then one single-shot retry on `OPENAI_FALLBACK_MODEL`.

## 12. The audit trail

Four action kinds only: `ai.tool_invoked` · `ai.tool_completed` · `ai.tool_blocked` ·
`ai.tool_failed`. Resource is `ai_tool`; the tool name lands in `resourceId` and `after.tool`.
`after._ai = { requestedBy, role, reason? }`.

`audit_log` is append-only **by convention** — there is no trigger or `REVOKE` enforcing it.

## 13. Changing this safely

1. **Read [`.claude/rules/ai-work.md`](.claude/rules/ai-work.md) first** — it owns the smoke +
   eval gates.
2. A new tool: `defineTool` → register in `tools/index.ts` → add a contract in
   `docs/ai/tool-contracts/` → add eval cases → run `npm run docs:state`.
3. Pick the risk tier deliberately. Anything that leaves the building is `outbound` at minimum.
4. CI evals trigger only on `src/lib/ai/**` — keep pure AI-adjacent helpers in `src/lib/` so
   an unrelated change does not burn OpenAI quota.
5. New side-effect surfaces ship **dark**: env flag default-off plus idempotency, so re-fires
   are harmless.
6. Never let a read-model return a sensitive value. Labels and aggregates only.
