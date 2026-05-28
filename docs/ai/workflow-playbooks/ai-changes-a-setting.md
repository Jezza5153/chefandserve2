# Workflow: AI changes a setting (PA assisted-execute)

> The future AI PA changing a setting on a user's behalf. Anchored by
> [`../ai-pa-access-model.md`](../ai-pa-access-model.md). Not built yet — this is
> the contract the Layer-4 tool code mirrors.

## Purpose

Jezza's target: "the PA helps me change settings." This playbook is the canonical
flow for the PA actually mutating a (non-destructive) setting — distinct from a
human "Bekijk als" ([`act-as-user-to-fix-setting.md`](./act-as-user-to-fix-setting.md)).
The PA acts under its **own service identity** and records who asked, on whom, and
why — so it is full-capability but never an unaccountable backdoor.

---

## Actors

- **Requesting human** — owner/super_admin (or, within their ceiling, a chef/klant
  for their own settings) who asks the PA to change something.
- **AI PA** — acts under its own service account; prepares a preview, then (after
  explicit confirm) calls the existing audited domain function.
- **Target user** — whose setting changes.

---

## Source tables

- Whatever the underlying setting writes (e.g. `chefs`, `clients`,
  `user_settings`, `notification_routes`) — the PA reuses the SAME domain function
  a human would.
- `audit_log` — via `recordAuditCore` (the PA is not a request scope; it must NOT
  use `recordAuditFromRequest`).

---

## Flow (assisted_execute, Mode 3)

1. **Read + ground.** PA confirms the requesting human's RBAC allows the change
   (`role-permission-matrix.md`); reads current value.
2. **Draft + preview.** PA shows exactly what will change: field, from → to,
   target user, and the captured reason. No mutation yet.
3. **Explicit confirm.** Human clicks a dedicated button containing the exact
   action + target ("Zet uurtarief-zichtbaarheid AAN voor Daniel"). Generic "ja"
   is not enough.
4. **Execute.** PA calls the domain function with a delegation context, which
   writes the business mutation AND the delegation audit row (fail-closed —
   awaited; a failed audit aborts).
5. **Confirm back.** PA reports done + cites the audit row.

---

## The delegation audit record

```
audit_log:
  user_id           = <pa_service_account>
  impersonator_user_id = null            -- NOT human impersonation
  action            = 'ai.<surface>.<action>'
  resource          = '<table>'  resource_id = '<id>'
  before            = { …prior… }
  after             = { …new…, _pa: { requestedBy, target, reason, tool, mode:'assisted_execute', confirmedAt } }
```

Forensics: `WHERE user_id = <pa> AND after->'_pa'->>'requestedBy' = <human>`.

---

## What the PA may change this way

Non-destructive settings only: profile fields, availability, notification
routes/preferences (`user-settings`), client type/tags/favorite-blocked
(`client-taxonomy-tools.md`), non-cancel shift status. These are exactly the
writes allowed during human Bekijk-als.

## AI must never do (blocked pending an approval workflow)

AVG erasure/export, user/role mgmt + invite disable, payroll mutations/export,
billing, chef/client delete/deactivate/archive, irreversible cancellation,
integration tokens, webhook secrets, bulk destructive, `consent.accept`. These
reuse `assertImpersonationAllowed()` + the path denylist. The future unlock is an
explicit multi-party **approval workflow**, not a relaxation of the guards.

---

## Audit keys

- `ai.<surface>.<action>` (the PA suggestion + confirm, with `after._pa`).
- The underlying business event (e.g. `clients.update_type`) — the standard row.
- `ai.<surface>.<action>_blocked` if the carve-out refuses.
