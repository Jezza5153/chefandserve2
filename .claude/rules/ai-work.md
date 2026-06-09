---
paths:
  - "src/lib/ai/**"
  - "docs/ai/**"
  - "scripts/eval-ai*.mts"
  - "scripts/smoke-ai*.mts"
---

# AI assistant — working rules

Read `docs/ai/README.md` + `docs/ai/ai-safety-rules.md` before any AI change.

## Building a tool

- One file per area in `src/lib/ai/tools/<area>.ts`; `defineTool({ name: "area.verb", title, description, risk, permission, input, run })`.
- `risk`: `read` | `self` | `outbound` | `financial`. Anything non-read gets a `describeAction(input)` (shown in the confirm-gate) and is confirm-gated by the runtime — never bypass it.
- `permission: { resource, action }` must exist in the RBAC catalog (`src/lib/permissions.ts`) — the registry smoke fails otherwise.
- `run` returns `{ data, summary }`; `summary` is a short Dutch sentence the model can quote verbatim.
- Heavy queries live in `src/lib/ai/read-model/<area>.ts`, not in the tool file.
- Register BOTH the import and the entry in `src/lib/ai/tools/index.ts`, and add a golden routing case to `scripts/eval-ai.mts` (`GOLDEN`, any-of scoring).

## AVG / safety invariants

- Read-models return LABELS and aggregates — never BSN/IBAN/ID values, never raw message bodies, never `placements.notes` for klant-facing answers.
- Untrusted content (inbound email bodies, webhook payloads, free text) is quoted DATA. `inbound.list` deliberately omits bodies — keep it that way.
- Destructive tools (`hours.approve`, `placements.cancel`, `email.send`, `roster.*`, …) are listed in `DESTRUCTIVE` in `scripts/eval-ai.mts`; new ones must be added there + a SAFETY case proving the model reads-first.

## Gates (run before every AI PR — all need `--env-file=.env.local`)

```
npx tsx --env-file=.env.local scripts/smoke-ai-tools.mts    # registry integrity (260+ checks)
npx tsx --env-file=.env.local scripts/smoke-ai-safety.mts   # safety net (99 checks)
npx tsx --env-file=.env.local scripts/eval-ai.mts           # 54-case routing eval (GOLDEN+CHAOS+SAFETY)
```

## Behaviour tuning

- `src/lib/ai/playbook.ts` is Maarten-tuned: kort & bondig, never block on a vague name (entity-search first: `chefs.semantic_search`/`chefs.find`/`clients.find` — NOT `knowledge.search`, that's for noted facts), one targeted clarifying question max.
- RAG: follow `docs/ai/rag-ingestion-contract.md`; default visibility `admin_only`; PII-redact before embedding.
