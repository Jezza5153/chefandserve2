# `docs/ai/` — AI readiness for Chef & Serve

> **The AI layer is LIVE** (since 2026-06): agent loop + ~90 registered tools (79 owner +
> 10 portal, count via `scripts/smoke-ai-tools.mts`), RAG (nightly ingest + `knowledge.search`),
> chat surfaces for owner/chef/klant, a 66-case eval that gates AI-touching PRs in CI, and the
> proactive tier (watchdog · onboarding-nudge · daily briefing · inbound e-mail capture).
> This folder is the contract + safety documentation FOR that live layer — read it before any
> AI change. Newest consolidated contract: `tool-contracts/2026-06-additions.md`.

**Companion docs (do not duplicate, link only):**
- [`../../AI_INTEGRATION.md`](../../AI_INTEGRATION.md) — strategic 4-layer architecture, data inventory, phased rollout plan. **Read that first** for the why and the eventual shape. This folder is the operational underbelly.
- [`../../MEMORY.md`](../../MEMORY.md) — single source of truth for "what is currently shipped".
- [`../../WORKFLOW.md`](../../WORKFLOW.md) — process map. Every workflow playbook here cites a section in WORKFLOW.md.
- [`../../BUILD_PLAN.md`](../../BUILD_PLAN.md) and [`../../ROADMAP.md`](../../ROADMAP.md) — sequence + scope.

---

## What lives where in this folder

### Base files (ship in PR-AI-0)

| File | What it is |
|---|---|
| [`ai-build-roadmap.md`](./ai-build-roadmap.md) | **Start here for build order.** The sequence, the hard preconditions (model key + go + history + budget), and a "done" bar per stage (smart-match → read tools → admin copilot → chef/klant PAs). Matching stays rule-based until Stage 1 ships. |
| [`ai-product-vision.md`](./ai-product-vision.md) | What the personal assistant looks like per role (chef, klant, admin) once it exists. Concrete example prompts and answers. |
| [`source-of-truth-map.md`](./source-of-truth-map.md) | For every fact the AI might surface — *which table holds it, who can change it, how stale can it be*. The AI's grounding contract. |
| [`role-permission-matrix.md`](./role-permission-matrix.md) | RBAC table mapped to AI tool access. Which tools each role can call, which it can draft, which is forbidden. |
| [`rag-source-catalog.md`](./rag-source-catalog.md) | Every potential RAG source classified: **broad index**, **access-filtered**, **restricted**, **NEVER index**. |
| [`rag-ingestion-contract.md`](./rag-ingestion-contract.md) | Chunking strategy, metadata schema, retrieval rules. The contract between the indexer worker and the retriever. |
| [`workflow-catalog.md`](./workflow-catalog.md) | Index of all workflow playbooks under `workflow-playbooks/`. |
| [`ai-safety-rules.md`](./ai-safety-rules.md) | The 4 operating modes (read-only · draft · assisted execute · autonomous safe) and the 10 hard rules. **Required reading before any AI work.** |
| [`ai-audit-and-logging.md`](./ai-audit-and-logging.md) | `ai.*` audit event names, payload schema, retention policy. |
| [`ai-evaluation-set.md`](./ai-evaluation-set.md) | ≥20 golden questions with expected behavior + the regression test suite. |
| [`ai-glossary.md`](./ai-glossary.md) | Chef & Serve domain language for the AI: *vakniveau*, *segment*, *Payingit*, *AVG*, etc. |

### Workflow playbooks (`workflow-playbooks/`)

Each PR-CHEF-N ships its own playbook with the same template. **Base set landed in PR-AI-0; each PR-CHEF-N fills the body when it ships its actual code.**

| Playbook | Scope (WORKFLOW.md ref) | Ships with |
|---|---|---|
| [`hours-trust-chain.md`](./workflow-playbooks/hours-trust-chain.md) | WORKFLOW.md Part 2.1 — chef → klant → admin → exported | PR-CHEF-1 |
| [`shift-proposal-accept-confirm.md`](./workflow-playbooks/shift-proposal-accept-confirm.md) | WORKFLOW.md Part 1.6 | (current) |
| [`chef-cancellation.md`](./workflow-playbooks/chef-cancellation.md) | WORKFLOW.md Part 2.2 — severity tiers | PR-CHEF-5 |
| [`client-hours-signing.md`](./workflow-playbooks/client-hours-signing.md) | WORKFLOW.md Part 2.1 (sub-flow) | PR-CHEF-1 |
| [`admin-bulk-approval.md`](./workflow-playbooks/admin-bulk-approval.md) | WORKFLOW.md Part 2.1 (sub-flow) | PR-CHEF-3 |
| [`profile-change-request.md`](./workflow-playbooks/profile-change-request.md) | WORKFLOW.md Part 2.3 | PR-CHEF-4 |
| [`payroll-export.md`](./workflow-playbooks/payroll-export.md) | WORKFLOW.md Part 2.1 final stage | PR-CHEF-7 |
| [`avg-consent.md`](./workflow-playbooks/avg-consent.md) | WORKFLOW.md Part 2.5 | PR-CHEF-10 |
| [`privacy-request.md`](./workflow-playbooks/privacy-request.md) | WORKFLOW.md Part 2.6 | PR-CHEF-10 |
| [`backup-restore.md`](./workflow-playbooks/backup-restore.md) | New cron + scripts | PR-CHEF-13 |

### Tool contracts (`tool-contracts/`)

One file per surface. Each contract follows the template documented in [`tool-contracts/README.md`](./tool-contracts/README.md).

| File | Tools |
|---|---|
| [`hours-tools.md`](./tool-contracts/hours-tools.md) | `hours.list_queue`, `hours.summarize`, `hours.draft_reminder`, `hours.approve` (assisted), `hours.reject` (assisted) |
| [`shift-tools.md`](./tool-contracts/shift-tools.md) | `shifts.find_candidates`, `shifts.propose_placement` (assisted), `shifts.cancel` (forbidden autonomous) |
| [`notification-tools.md`](./tool-contracts/notification-tools.md) | `notifications.draft_message`, `notifications.send` (assisted), `notifications.list_unread` |
| [`profile-tools.md`](./tool-contracts/profile-tools.md) | `profile.read`, `profile.draft_change_request`, `profile.approve_change_request` (assisted) |
| [`integration-tools.md`](./tool-contracts/integration-tools.md) | `integrations.health`, `integrations.retry_outbox` (assisted), `payroll.draft_batch`, `payroll.export_batch` (assisted) |
| [`privacy-tools.md`](./tool-contracts/privacy-tools.md) | `privacy.list_requests`, `privacy.draft_response`, `consent.list_status` (read-only). **`consent.accept` is FORBIDDEN for AI.** |

---

## How to read this folder

1. **Start with `ai-safety-rules.md`** — non-negotiable boundaries.
2. **Then `source-of-truth-map.md`** — what the AI can ground on.
3. **Then `workflow-catalog.md`** — pick a playbook to understand a specific flow.
4. **Then matching `tool-contracts/<surface>.md`** — what the AI is allowed to call.
5. **Validate against `ai-evaluation-set.md`** — golden tests every release runs.

## How to extend this folder

Co-evolution rule (from the active plan):

- Every new server action that mutates state → add a row to a tool contract.
- Every new workflow → add a playbook using the template.
- Every new high-impact action → update `ai-safety-rules.md` if forbidden.
- Every new golden question worth catching → add to `ai-evaluation-set.md`.

If you add a new playbook, also add the link to [`workflow-catalog.md`](./workflow-catalog.md) and to this README's table.

---

## Status

| Phase | What exists today (2026-06-10) |
|---|---|
| Base docs spine | ✅ |
| Workflow playbooks bodies | ✅ co-evolved through PR #145 |
| Tool contracts | ✅ 19 docs incl. the consolidated `2026-06-additions.md` |
| Read-models | ✅ ~30 modules in `src/lib/ai/read-model/` (labels/aggregates, AVG-safe) |
| RAG index | ✅ LIVE — `ai_embeddings` (manual migration, dev+prod), nightly `/api/cron/rag-ingest`, `knowledge.search` |
| LLM endpoint | ✅ `/api/ai/chat` (owner) + `/api/ai/portal/chat` (chef/klant) — gpt-5.4, breaker+fallback, budget-capped |
| Chat UI | ✅ `AssistantChat` (owner dashboard + portals), 👍/👎 feedback, cross-device persistence |
| AI tool handlers (Layer 3) | ✅ ~90 registered (79 owner + 10 portal), confirm-gated per risk tier, audit-sinked |
| Eval / regression net | ✅ 66 cases, gates AI-touching PRs in CI (`ai-eval.yml`) |
| Proactive tier | ✅ watchdog · onboarding-nudge · daily briefing · inbound capture (+ mining dark) |

This folder is the **contract for the live layer** — keep it co-evolving with every AI PR.
