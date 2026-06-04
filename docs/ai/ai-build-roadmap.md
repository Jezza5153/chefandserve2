# AI build roadmap — the order, the gates, the definition of done

> **Design-only deliverable (no code in this PR).** The *what* and the *shape* of the AI
> layer already live in this folder + `AI_INTEGRATION.md`. This file is the **build
> sequence**: the order to build in, the hard preconditions before each stage, and a
> concrete "done" bar so nobody guesses. Matching **stays rule-based** until Stage 1
> ships and is proven.

## Where we are today (all design, nothing live)
- **Embedding scaffolding, dormant.** `workers/embedding-refresh.ts` runs in OBSERVE
  mode with no `OPENAI_API_KEY` (no-op). `pgvector` columns exist on the relevant tables
  (PR-9-prep). No vectors are generated.
- **A rule-based matcher with a seam.** `src/lib/domain/matching.ts` (`findMatchesForShift`)
  scores on vakniveau + segment + experience and exposes a **Phase-9 hook** where a
  similarity signal can be blended in. It is honest + deterministic today.
- **The full design is written down**: `ai-product-vision.md` (per-role PA), `ai-pa-access-model.md`
  (who can ask what), `ai-safety-rules.md`, `ai-audit-and-logging.md`, `rag-ingestion-contract.md`
  + `rag-source-catalog.md` (the chunked `ai_embeddings` target shape), `source-of-truth-map.md`,
  `role-permission-matrix.md`, and **17 tool contracts** under `tool-contracts/`.
- **NEW (Phase 1 — KPI depth):** `chef_metrics_daily` + `client_metrics_daily` snapshots now
  accumulate the **historical signal** that retrieval + ranking quality depend on. The longer
  these run before Stage 1, the better the first AI lands.

## Hard preconditions (gates — true before ANY stage starts)
1. **A model key** — `OPENAI_API_KEY` (embeddings + chat) and/or an Anthropic key. Until one is
   set, every stage below is inert by construction. This is the single biggest gate.
2. **A deliberate go decision** from the owner — AI changes the product's trust surface; it ships
   on purpose, not by drift.
3. **Enough history** — let the KPI snapshots + `chef_events` accumulate (weeks, not days) so
   retrieval has something real to retrieve. Backfilling snapshots (`metrics-snapshot --backfill`)
   helps but does not replace lived signal.
4. **Spend guardrails** — a per-day token budget + a kill switch env flag, mirroring the existing
   dark-launch pattern (`REMINDERS_ENABLED`, `KPI_FORECAST_ENABLED`).

---

## Stage 1 — Smart-match AI (lowest blast radius, highest leverage)
**Goal:** make the rule-based matcher *better*, not autonomous. Blend a vector-similarity signal
into the existing score; never let it act on its own.

- **Build:** migrate the per-row embedding columns → the **chunked `ai_embeddings` table** exactly
  per `rag-ingestion-contract.md`; flip `embedding-refresh` from OBSERVE to generating (gated by the
  key); add a retrieval helper with the **visibility filter** from `ai-pa-access-model.md` /
  `source-of-truth-map.md`; plug cosine similarity into `matching.ts` **behind the existing Phase-9
  hook** as one more weighted component.
- **Implements:** `matching-tools.md`, `rag-ingestion-contract.md`, `rag-source-catalog.md`.
- **Done when:** a shift's ranked chefs are unchanged in ordering for the no-key path (pure fallback),
  and the blended path is A/B-comparable + explainable (the existing `reasons[]` still populated).
  Smoke on a Neon clone like the KPI smokes.
- **Guardrail:** similarity is a *tiebreaker/booster*, never a hard filter — a chef the rules would
  surface is never hidden by a vector.

## Stage 2 — AI read-model + the tool handlers
**Goal:** give a future assistant safe, typed, permission-scoped *read* access — still no chat UI.

- **Build:** implement the handlers behind the **17 `tool-contracts/`** (hours/shifts/profile/roster/
  rating/…), each enforcing the `role-permission-matrix.md` + `source-of-truth-map.md` access mode
  (`read_filtered` etc.). Reuse the existing domain read-models (`chef-history`, `client-history`,
  `metrics-history`, `roster-intel`, `leaderboards`) — the tools are thin, audited wrappers.
- **Implements:** every `tool-contracts/*.md`; `ai-audit-and-logging.md` (`ai.*` audit events on each call).
- **Done when:** each tool has a contract test proving it returns only data the caller's role may see
  (chef sees own, klant sees own, admin sees all), and every call writes an `ai.read.*` audit row.
- **Guardrail:** write/mutating tools stay **disabled** in this stage — read-only first.

## Stage 3 — Admin copilot (internal, highest-trust users first)
**Goal:** a chat surface for the owner/planner that answers from the read tools + RAG, and can
*propose* (not silently perform) assisted actions.

- **Build:** a chat UI in the admin shell; RAG over `ai_embeddings`; the read tools from Stage 2;
  a small set of **assisted actions** that always render a confirm step and write `ai.action.*` audit
  events. Enforce `ai-safety-rules.md` (no fabricated numbers — answers cite the snapshot/tool source).
- **Implements:** `ai-product-vision.md` (admin section), `workflow-catalog.md` + `workflow-playbooks/`.
- **Done when:** the copilot answers a roster/KPI/chef question with a cited source, refuses out-of-scope
  asks, and every assisted action is confirm-gated + audited. Runs against the `ai-evaluation-set.md`.
- **Guardrail:** internal users only; destructive actions remain human-confirmed; spend budget enforced.

## Stage 4 — Chef + klant personal assistants (the full 3-PA vision)
**Goal:** extend the assistant to chefs and klanten, each strictly scoped to their own data.

- **Build:** per-role PA surfaces per `ai-pa-access-model.md`; the same tool layer with the role's
  visibility filter; onboarding/hours/availability flows from `forms-and-onboarding.md`.
- **Implements:** `ai-product-vision.md` (chef + klant sections), the full `ai-pa-access-model.md`.
- **Done when:** a chef PA can answer "when do I work next / what did I earn" from *only* that chef's
  data, a klant PA from only that klant's, both proven by the contract tests from Stage 2, with the
  full `ai-evaluation-set.md` green.
- **Guardrail:** the hardest privacy surface — no cross-tenant leakage; PII redaction per
  `pii-inventory.md`; every answer auditable.

---

## Sequencing summary
`gates (key + go + history + budget) → Stage 1 (smart-match) → Stage 2 (read tools) → Stage 3 (admin copilot) → Stage 4 (chef + klant PAs)`

Each stage is independently shippable and dark-launchable. Nothing here weakens the current honest,
deterministic behaviour: until Stage 1 is live and proven, **matching stays rule-based** and the app
shows only real, sourced numbers.
