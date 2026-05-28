# Role-Permission Matrix → AI Tool Access

> The AI inherits the caller's RBAC. It cannot escalate. This matrix says: **for each role, which tools may be called, drafted, or are forbidden**.

The base RBAC table is in `src/lib/permissions.ts` (resource × action pairs). The roles that exist today (per `MEMORY.md`):

- `super_admin` — Maarten + Jezza. Full control. Only role that can reset 2FA, modify users.
- `owner` — operator role (Maarten in business mode). Full business control: chefs, clients, shifts, hours, payroll.
- `chef` — chef portal user. Own data only.
- `client` — klant portal user. Own data only.

Future-reserved (per `BUILD_PLAN.md`):
- `bookkeeper` — restricted financial role; PR-CHEF-7+ will introduce.
- `coordinator` — restricted operations role; can propose placements but not approve hours.

---

## Tool access matrix

Legend:
- `R` — AI may call as Mode 1 (read-only).
- `D` — AI may draft (Mode 2) but never execute.
- `A` — AI may execute only after explicit human confirmation (Mode 3).
- `S` — AI may execute autonomously (Mode 4 safe action) — only listed where explicitly approved.
- `—` — forbidden for this role, even with confirmation.

| Tool (namespace.action) | super_admin | owner | bookkeeper (future) | coordinator (future) | chef | client |
|---|---|---|---|---|---|---|
| **Shifts** | | | | | | |
| `shifts.find_candidates` | R | R | — | R | — | — |
| `shifts.read` | R | R | R | R | R (own placements) | R (own shifts) |
| `shifts.propose_placement` | A | A | — | A | — | — |
| `shifts.confirm_placement` | A | A | — | — | — | — |
| `shifts.cancel` | A | A | — | — | A (own only) | — |
| `shifts.manual_add_hours` | A | A | — | — | — | — |
| **Hours** | | | | | | |
| `hours.list_queue` | R | R | R | — | R (own) | R (own) |
| `hours.read` | R | R | R | R | R (own) | R (own at klant) |
| `hours.summarize` | R | R | R | R | R (own) | R (own at klant) |
| `hours.submit` | — | — | — | — | A (own draft) | — |
| `hours.sign` (client side) | — | — | — | — | — | A (own at klant) |
| `hours.reject_by_client` | — | — | — | — | — | A (own at klant) |
| `hours.draft_reminder` | D | D | D | — | — | — |
| `hours.send_reminder` | A | A | A | — | — | — |
| `hours.approve` (admin) | A | A | A | — | — | — |
| `hours.reject_by_admin` | A | A | A | — | — | — |
| `hours.bulk_approve` (bulk) | A | A | A | — | — | — |
| `hours.create_correction` | A | A | A | — | — | — |
| `hours.approve_correction` | A | A | A | — | — | — |
| **Notifications + email** | | | | | | |
| `notifications.list_unread` | R (any) | R (any) | R (own + own queue) | R (own) | R (own) | R (own) |
| `notifications.mark_read` | S (own) | S (own) | S (own) | S (own) | S (own) | S (own) |
| `notifications.draft_message` | D | D | D | D | — | — |
| `notifications.send` | A | A | A | A | — | — |
| `email.read_status` | R | R | R | R | — | — |
| **Profile** | | | | | | |
| `profile.read` | R (any) | R (any) | R (own + chefs/clients) | R (chef + own) | R (own) | R (own) |
| `profile.draft_change_request` | D | D | — | — | D (own) | D (own) |
| `profile.submit_change_request` | A | A | — | — | A (own) | A (own) |
| `profile.approve_change_request` | A | A | — | — | — | — |
| `profile.reject_change_request` | A | A | — | — | — | — |
| **Integrations** | | | | | | |
| `integrations.health` | R | R | R | — | — | — |
| `integrations.retry_outbox` | A | A | A | — | — | — |
| `payroll.draft_batch` | A | A | A | — | — | — |
| `payroll.export_batch` | A | A | A | — | — | — |
| `payroll.void_batch` | A | A | — | — | — | — |
| **Documents** | | | | | | |
| `documents.list_for_chef` | R | R | — | R | R (own) | R (only verified + clientVisible at active placement) |
| `documents.read_metadata` | R | R | — | R | R (own) | R (filtered) |
| `documents.read_bytes` (presigned URL) | A (audit-logged) | A | — | — | A (own) | A (filtered) |
| `documents.verify` | A | A | — | — | — | — |
| `documents.set_visibility` | A | A | — | — | — | — |
| `documents.reject` | A | A | — | — | — | — |
| **AVG / privacy** | | | | | | |
| `privacy.list_requests` | R | — | — | — | R (own) | R (own) |
| `privacy.create_request` | A (own) | A (own) | A (own) | A (own) | A (own) | A (own) |
| `privacy.fulfill_request` | A | — | — | — | — | — |
| `privacy.upload_response` | A | — | — | — | — | — |
| `consent.list_status` | R (own + counts) | R (counts) | — | — | R (own) | R (own) |
| `consent.accept` | — | — | — | — | — | — |
| **Auth + identity** | | | | | | |
| `auth.list_users` | R | R | — | — | — | — |
| `auth.invite_internal` | A | — | — | — | — | — |
| `auth.invite_chef_to_portal` | A | A | — | — | — | — |
| `auth.invite_client_to_portal` | A | A | — | — | — | — |
| `auth.reset_2fa` | A | — | — | — | — | — |
| `auth.disable_user` | A | — | — | — | — | — |
| `auth.change_role` | A | — | — | — | — | — |
| **Audit + observability** | | | | | | |
| `audit.search` | R | R | R | — | R (own) | R (own) |
| `errors.search` | R | R | — | — | — | — |
| `errors.resolve` | A | A | — | — | — | — |

### Hard rules baked in everywhere

Regardless of the table above, the following constraints always hold:

1. **`consent.accept` is `—` for AI in every column.** Consent is personal, never delegable. This is the single most-tested boundary in `ai-evaluation-set.md`.
2. **`auth.reset_2fa` always requires `super_admin` + explicit confirmation.** Even Maarten's owner role cannot reset 2FA via AI.
3. **AI never directly mutates `payments`, `payroll_batches`, or external IDs.** AI may DRAFT a batch and ASSIST an export, but the human clicks "Exporteer".
4. **Documents bytes (`documents.read_bytes`) are presigned-URL only.** The AI may produce the URL after confirming role + ownership, but it cannot embed or quote the document content.
5. **Cross-tenant boundary is enforced server-side.** Chef cannot read another chef's data; klant cannot read another klant's data. The AI calling a tool with the chef's session cannot widen its scope.

---

## How the AI checks before calling a tool

```
1. Resolve caller from session (`session.user.id` + `session.user.kind` + `session.user.roles`).
2. Look up the tool in this matrix.
3. If the cell is `—` for this role → refuse with a polite explanation.
4. If the cell is `D` → only draft; never call the action.
5. If the cell is `A` → produce a preview, ask for explicit confirmation, then call.
6. If the cell is `S` → autonomous safe; still emit `ai.tool_executed` audit row.
7. If the cell is `R` → call the read.
```

### What "explicit confirmation" means

A confirmation button containing the exact action and destination must be clicked. Generic "ja" or "ok" in chat is NOT enough — the UI must surface a dedicated button. See the `tool-contracts/` files for per-tool confirmation copy.

---

## super_admin "Bekijk als" (impersonation)

When a super_admin views AS another user, the **effective** session is the
target's — so the matrix above applies with the **target's** column, not
super_admin's. Two extra rules layer on top (shipped + audited):

- **Destructive carve-out.** Regardless of the target's column, genuinely
  destructive / irreversible / sensitive-export actions are BLOCKED while
  impersonating — enforced by `isImpersonationDeniedPath` (path + method, in
  middleware) AND `assertImpersonationAllowed()` (action layer, two layers). See
  `../../src/lib/impersonation-denylist.ts`. Blocked set: AVG erasure/export,
  user/role mgmt + invite disable, payroll mutations/export, billing, chef/client
  delete/deactivate/archive, irreversible cancellation, integration tokens,
  webhook secrets, bulk destructive.
- **Audited as the real super_admin.** Every impersonated write records
  `impersonator_user_id` = the real super_admin and `after._imp` = the
  impersonation session id, so "who really did it" is always answerable.

The AI never SETS impersonation (there is no `bekijk_als.*` write tool — see
`tool-contracts/impersonation-tools.md`). It may READ whether an impersonation
session is active to caveat its answers.

## AI-PA service-identity tier

The future AI PA is **not** a role in this table — it acts under its **own
service identity** and inherits the **requesting human's** ceiling from this
matrix (it can never exceed the human's cells). On top of that ceiling, the PA
is held to the same destructive carve-out as impersonation (same guards), and
destructive actions stay blocked pending an explicit approval workflow. Full
contract: `ai-pa-access-model.md`.

## Future role: `bookkeeper`

When PR-CHEF-7 ships its admin-bookkeeper distinction, the bookkeeper role:
- Reads everything finance (`hours`, `payroll_batches`, `shift_hour_corrections`, `email_messages`).
- Drafts + assist-executes finance tools.
- CANNOT propose placements, modify shifts, invite users.

The matrix already reflects this.

## Future role: `coordinator`

When PR-CHEF-FUT ships:
- Reads + assists placements + shifts.
- CANNOT touch finance, cannot invite, cannot delete.

---

## Pre-flight checklist when adding a new tool

When adding a new tool to `tool-contracts/`, also:

- [ ] Add a row to this matrix with the right access cell per role.
- [ ] Default to `—` (forbidden) unless there's a clear use case for a role.
- [ ] If the tool mutates payroll, identity, consent, permissions, or sends bulk communications → it MUST be `A` or `—`, never `S`.
- [ ] Reflect any new audit event in `ai-audit-and-logging.md`.
- [ ] Add a golden test to `ai-evaluation-set.md` that probes the boundary (e.g. "what if a chef asks for it?").
