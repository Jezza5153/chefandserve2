# Workflow: Act as a user to fix a setting ("Bekijk als")

> Human super_admin impersonation. Maps to the impersonation modules
> (`src/lib/domain/impersonation.ts`, `src/middleware.ts`,
> `src/lib/impersonation-denylist.ts`). Ships with the write-impersonation phase.

## Purpose

Maarten or Gina call: "I can't get this setting right, can you fix it as me?"
Jezza (the single super_admin) opens their super-admin view, clicks **Bekijk als**
on that account, and fixes the setting **as them** — so the change lands on the
right user, behaves exactly as it would for them, and is fully audited to the real
super_admin behind it. Equally used to debug "this chef can't see their shift".

This is a HUMAN mechanism. The AI never starts/stops it (see
[`../tool-contracts/impersonation-tools.md`](../tool-contracts/impersonation-tools.md)).
For the AI doing-on-behalf, see [`ai-changes-a-setting.md`](./ai-changes-a-setting.md).

---

## Actors

- **super_admin (Jezza)** — starts "Bekijk als" on a target; performs the fix.
- **Target user** — Maarten/Gina (owner), or any chef/klant. Their data is what changes.
- **System** — applies the session overlay + the audit stamping + the guards.

---

## Source tables

- Cookies (not a table): `cs_impersonate_target`, `cs_impersonate_actor`, `cs_impersonate_sid` (HttpOnly, 1h).
- `users`, `roles`, `userRoles` — target lookup + the "never impersonate a super_admin" guard.
- `audit_log` — `impersonation.start` / `.stop` + every write during the session.

---

## Flow

1. super_admin POSTs `/api/impersonate/[userId]` → `startImpersonation`:
   - guards: not self, target exists, target is NOT super_admin;
   - sets the 3 cookies, mints `sid = crypto.randomUUID()`;
   - writes `impersonation.start` with `after = { targetEmail, targetKind, _imp: sid }`.
2. `requireAuth`/`requireRole` overlay the EFFECTIVE session as the target
   (`applyImpersonation`), tagging `session.user.impersonator = { id, name }`.
3. The banner shows on every portal: *"Je kijkt en werkt als {naam}. Alles wat je
   doet wordt vastgelegd als jou. Onomkeerbare acties zijn geblokkeerd."*
4. super_admin fixes the setting. Each write is audited via
   `recordAuditFromRequest`: `user_id` = target, `impersonator_user_id` = real
   super_admin, `after._imp` = sid.
5. super_admin clicks **Stop** → `/api/impersonate/stop` → `stopImpersonation`
   clears cookies, writes `impersonation.stop` with `after._imp = sid`.

---

## What is allowed vs blocked while impersonating

| Class | Behaviour |
|---|---|
| Normal "fix a setting" writes (profile, availability, notif routes, client type/tags, non-cancel shift status, comments, ratings) | **Allowed**, audited as the impersonator |
| Plain views (GET) | **Allowed** (the point of "see what they see") |
| Destructive: AVG erasure/export, user/role mgmt + invite disable, payroll mutations/export, billing, chef/client delete/deactivate/archive, irreversible cancellation, integration tokens, webhook secrets, bulk destructive, personal-data export | **Blocked (403)** — path denylist + `assertImpersonationAllowed()` |

`/api/impersonate/*` is never matched by the write gate → **Stop always works**.

---

## Audit keys

- `impersonation.start`, `impersonation.stop` (carry `after._imp`).
- Any business event during the session keeps its own action key + gains
  `impersonator_user_id` + `after._imp`.
- Forensic: `SELECT … FROM audit_log WHERE after->>'_imp' = '<sid>' ORDER BY created_at;`
  returns start → writes → stop for that one session.

---

## AI surface

- READ only: `impersonation.read_active` so the AI can caveat ("Let op: je kijkt
  nu als Maarten").
- The AI may EXPLAIN how to use Bekijk als, and may help draft the actual setting
  change once impersonation is active (subject to the same carve-out).

## AI must never do

- Start or stop impersonation (`impersonation.start`/`.stop` are human-only).
- Claim to "become" a user, or perform a destructive action "because we're in
  Bekijk als" — the carve-out holds regardless of channel.
