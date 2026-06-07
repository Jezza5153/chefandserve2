# Owner Personal Assistant — V1 (the locked philosophy)

> This supersedes the 3-PA vision in `ai-product-vision.md` **for V1**. Decided with Maarten
> June 2026. The earlier docs remain the long-term reference; this is what we are building now.

## Vision

**One assistant, for the owner (Maarten) only.** Not a chef PA, not a klant PA — a single
personal assistant that takes real action on Maarten's behalf. It gives data, sets up
reminders, sends emails/WhatsApp on his say-so, finds who's missing or hasn't-approved their
hours and nudges them. A real PA, reachable across channels.

**Capability principle:** _if Maarten can do it in the system, the assistant can do it._ Its
power is the union of the tools we wire — and its ceiling is exactly Maarten's RBAC, never more.

**Channels (in build order):** dashboard chat → WhatsApp → voice (call it, talk to it). The
core is channel-agnostic; channels are thin adapters onto the same runtime.

Why owner-only is the right V1: it deletes the hardest, highest-risk half of the original
design — cross-tenant isolation, per-role visibility filters, the curated klant-safe views.
One principal with full access. The remaining hard problem is **trusted action confirmation
across channels**, which is what the runtime is built around.

## Architecture (4 layers)

1. **Eyes — business read-model** (`src/lib/ai/read-model/`): one current picture of the
   business (rollups, planner cockpit, hours queues …). Read-only; every number traces to a query.
2. **Hands — tool layer** (`src/lib/ai/tools/`): every owner action as a typed, permission-
   tagged, risk-tiered, audited tool. One registry (`tools/index.ts`).
3. **Brain-stem — agent core** (`src/lib/ai/runtime/`): `runAgent` drives a pluggable `Brain`
   (the LLM, or a scripted stand-in for tests). `executeTool` is the gate every call passes:
   **validate → permission ceiling → confirm-gate → run + audit.** Pauses for confirmation,
   resumes when confirmed.
4. **Channels — thin adapters**: dashboard chat first; WhatsApp + voice plug into the same core.

The LLM is the LAST thing plugged in — everything above is built and tested key-free.

## Risk tiers + confirmation

Each tool declares a `RiskTier`:

| Tier | Meaning | Confirmation |
|------|---------|--------------|
| `read` | information, no side effects | none |
| `self` | changes only Maarten's own state (e.g. his reminder) | none |
| `outbound` | reaches a third party (email/WhatsApp a chef/klant) | one confirm |
| `financial` | moves money / irreversible (approve hours, payroll, delete) | strong confirm |

**Confirmation is channel-agnostic.** When a confirm-gated tool is first called, the server
mints a **signed HMAC token** bound to `{tool, exact inputs, requesting human}`
(`runtime/confirm-token.ts`). The channel turns it into a confirm gesture — a dashboard button,
a WhatsApp quick-reply, or a spoken "ja" — that echoes the token back. The token is verified
server-side. The LLM cannot mint or forge it, so it can never self-approve. Tokens are bound to
the inputs and the human (proven: replay on a different action or a different actor is denied).

## Security + audit

- **Ceiling = the human's real RBAC.** `runtime/actor.ts:resolveAiActor(userId)` builds the
  acting identity from `computeEffectivePermissionSet` — the SAME logic the app's own gates use
  (extracted into one shared function so they can't drift). super_admin → full catalog.
- **Dual-row audit.** The executor writes an `ai.tool_{invoked,completed,blocked,failed}` meta
  row (`runtime/audit-sink.ts`) with an `after._ai` delegation marker; the tool's own handler
  writes the business row (e.g. `shift_hours.admin_approved`). Both via `recordAuditCore`
  (worker/route-safe).
- **PA identity (V1):** the audit row's `userId` is Maarten's id + the `_ai` marker. When a
  dedicated PA service-account row is seeded, `resolveAiActor` returns its id instead — no other
  change needed.

## Hard limits (unchanged from the safety design, and they matter more now it acts)

Never reads out a BSN/IBAN, never decrypts anything, never touches exported payroll, never
resets 2FA. Must cite real data, never fabricate. Every action is logged. The assistant cannot
exceed the requesting human's permission ceiling.

## Build status

| Layer | State |
|-------|-------|
| Runtime spine (registry, executor, confirm-gate, agent loop) | ✅ built, `smoke-ai-spine` 25/25 |
| Security wiring (actor ceiling, audit sink, env flags) | ✅ built |
| Read-model + first tools (`business.overview`, `hours.list_awaiting_approval`, `hours.approve`) | ✅ built |
| Reminder action tool (outbound) | ⏳ next |
| Brain (OpenAI adapter, key-gated) + grounding | ⏳ |
| Dashboard chat surface | ⏳ |
| Eval harness (refusal + ceiling + grounding) | ⏳ |
| WhatsApp channel | ⏳ (pending API choice) |
| Voice channel | ⏳ (R&D / endgame) |

## Switch-on gates (owner-provided)

`AI_ENABLED=true` + `OPENAI_API_KEY` + `AI_CONFIRM_SECRET` (≥32 chars) + a per-day token budget.
Until then the whole layer is built, tested, and dormant — zero cost.

## Deferred / decisions still open

- Dedicated PA service-account user row (V1 uses Maarten's id + `_ai` marker).
- Embeddings / RAG retrieval — only needed for fuzzy-knowledge questions; most owner asks are
  tool-calls over structured data, so RAG is a later add, not a V1 dependency.
- WhatsApp API provider (Meta Cloud / Twilio / 360dialog) — decides whether we get tap-to-confirm
  buttons. Maarten to choose.
- Owner personal-reminders feature (table + tool) — does not exist yet; build when wiring the
  "remind me …" capability.
