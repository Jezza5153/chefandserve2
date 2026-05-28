# AI-PA Access Model — service identity, NOT human impersonation

> The anchor doc. Jezza wants the future AI PA to have **full access, full
> knowledge, all the tools, and the ability to change settings** — without
> getting blocked later, and without it ever becoming an unaccountable backdoor.
> This file defines HOW the PA is allowed to act, so the wiring is decided up
> front. Read this before adding any PA write capability.

Status: **design contract, not yet built.** The audit primitives it relies on
(`recordAuditCore`, `audit_log.impersonator_user_id`, `after._imp`) are live as
of the write-impersonation phase. The PA itself ships in Layer 4 (see
`../../AI_INTEGRATION.md`).

---

## The core distinction

There are two very different "act as someone else" mechanisms. Keep them apart.

| | Human **Bekijk als** (impersonation) | **AI PA** delegation |
|---|---|---|
| Who acts | A real super_admin (Jezza) **becomes** a target user | The PA acts under **its own service identity** |
| Identity in `audit_log` | `user_id` = target, `impersonator_user_id` = the super_admin | `user_id` = the PA service account, plus a structured `after` block naming the requesting human + target |
| Mechanism | `cs_impersonate_*` cookies + session overlay (`applyImpersonation`) | The PA calls domain functions with an explicit delegation context |
| Trigger | Maarten/Gina call: "I can't get this setting right" → Jezza fixes it as them | A human asks the PA to do something on a user's behalf |
| Destructive ops | Blocked (denylist + `assertImpersonationAllowed`) | Blocked (same guards) + a future explicit approval workflow |
| Lives in | `src/lib/domain/impersonation.ts`, `src/middleware.ts`, `src/lib/impersonation-denylist.ts` | `src/lib/tools/*` (future) + this contract |

**The PA does NOT log in as a human and it does NOT set the impersonation
cookies.** Human impersonation is a person-to-person trust mechanism; the PA is
a tool with its own accountable identity. Conflating the two would let the PA
hide behind a human's name — exactly what the audit trail is built to prevent.

---

## The delegation record (what every PA write captures)

Every PA action that mutates state writes — via `recordAuditCore` (the pure,
runtime-safe writer; the PA backend is NOT a request scope, so it must never use
`recordAuditFromRequest`) — an `audit_log` row shaped like:

```
audit_log:
  user_id           = <pa_service_account_id>      -- the PA acted
  impersonator_user_id = null                       -- NOT human impersonation
  action            = 'ai.<surface>.<action>'       -- e.g. ai.profile.update_setting
  resource          = '<table>'
  resource_id       = '<entity id>'
  before            = { …prior state… }
  after             = {
                        …new state…,
                        _pa: {
                          requestedBy: <human user id>,   -- who asked the PA
                          target:      <user id acted on>,-- whose data changed
                          reason:      "<free-text why>",  -- captured from the human
                          tool:        "<tool name>",      -- which contract
                          mode:        "assisted_execute",
                          confirmedAt: "<iso>"             -- human confirm timestamp
                        }
                      }
```

Forensics this guarantees (one SQL query each):
- "What did the PA do for Lisa today?" → `WHERE user_id = <pa> AND after->'_pa'->>'requestedBy' = <lisa>`.
- "Everything the PA ever changed on chef X" → `WHERE after->'_pa'->>'target' = <chefX>`.
- "Every PA action of a kind" → `WHERE action = 'ai.profile.update_setting'`.

This mirrors the human-impersonation correlation (`after._imp`) so the two
audit stories read the same way.

---

## Access tiers — what the PA may do

The PA inherits the **requesting human's** RBAC ceiling and can never exceed it
(`role-permission-matrix.md`). On top of that, every PA capability sits in one of
the four modes from `tool-contracts/README.md`:

1. **read** — grounded reads (the bulk of the PA). Always allowed within RBAC.
2. **draft** — prepares a change; the human applies it in the existing UI.
3. **assisted_execute** — prepares a preview; the human clicks an explicit
   confirm button; the PA then calls the mutation and writes the delegation
   record above. **This is how the PA "changes a setting."**
4. **autonomous** — only low-risk reversible self-scoped actions
   (`notifications.mark_read`). Never financial/identity/consent/bulk.

### What "changes settings" means in practice

The user's goal — "the PA helps me change settings" — maps to
**assisted_execute on the non-destructive surface**: chef/client profile fields,
availability, notification routes/preferences, client type/tags, shift status
(non-cancel), comments, ratings. These are the same writes a super_admin may do
during Bekijk-als, and they go through the same audited domain functions.

### What stays blocked (pending a future approval workflow)

The PA may **never** autonomously do the destructive set, even with a single
human confirm:

- AVG erasure / personal-data export / rectification
- user/role management, invite revoke/disable, privilege grants
- payroll mutations + export, billing/Stripe/payment/invoice
- chef/client deletion / deactivation / archive
- irreversible placement/shift cancellation
- integration-token / webhook-secret changes
- bulk destructive / import actions
- `consent.accept` — personal, never delegable (the single hardest boundary)

These reuse the SAME guards as human impersonation:
`assertImpersonationAllowed()` (action layer) + `isImpersonationDeniedPath`
(path layer). The future unlock for the PA is an **explicit multi-party approval
workflow** (e.g. a human owner approves a specific destructive PA action in a
dedicated queue) — NOT a relaxation of these guards. Until that ships,
destructive = blocked.

---

## Guardrails baked in

1. **Own identity, always.** The PA never assumes a human's session and never
   sets `cs_impersonate_*`. Its writes carry `user_id = pa_service_account`.
2. **RBAC ceiling = requesting human.** The PA cannot do for a human what the
   human cannot do themselves. Cross-tenant boundaries hold server-side.
3. **Fail-closed audit.** The delegation record is `await`ed before/with the
   mutation; a failed audit aborts the action (same posture as impersonated
   writes — see the neon-http single-tx caveat in `ai-audit-and-logging.md`).
4. **No destructive autonomy.** The denylist + action guard apply to the PA
   exactly as to a human impersonator. New destructive capability requires the
   approval workflow, documented here first.
5. **Reason captured.** Every assisted_execute records the human's stated reason
   in `after._pa.reason` — so the audit answers *why*, not just *what*.
6. **Service account is least-privilege.** The PA service account is created and
   scoped by a super_admin (never self-provisioned), is itself non-destructive
   by default, and is rotatable.

---

## Why this "doesn't get stuck later"

By deciding the access model now:
- The tool layer (`src/lib/tools/`) only has to wire the **delegation context**
  into `recordAuditCore` — the audit column + correlation already exist.
- The destructive carve-out is already enforced by shared guards, so the PA
  inherits it for free; we don't have to re-audit every mutation when the PA
  ships.
- The forensic queries are identical in shape to human impersonation, so the
  cockpit's "who really did it" surfaces work for the PA with no new plumbing.
- The only genuinely new build is the **approval workflow** for destructive PA
  actions — and that is explicitly deferred, not blocked by missing groundwork.

---

## Cross-references

- Human impersonation: `tool-contracts/impersonation-tools.md`, `role-permission-matrix.md` (§ Bekijk als).
- Audit shape + correlation: `ai-audit-and-logging.md` (§ impersonation + § AI delegation).
- The full safety posture: `ai-safety-rules.md`.
- Tool modes + the four-mode table: `tool-contracts/README.md`.
- Where the PA code will live: `../../AI_INTEGRATION.md` §7.
