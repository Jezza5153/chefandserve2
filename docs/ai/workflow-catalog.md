# Workflow Catalog

> Index of every workflow playbook in [`workflow-playbooks/`](./workflow-playbooks/). Each playbook follows the template documented in [`README.md`](./README.md).

The point of a playbook is so the AI can answer "what happens when X?" without inventing a flow. Every playbook cites the corresponding section in [`../../WORKFLOW.md`](../../WORKFLOW.md), the audit keys, the notifications fired, and what the AI is allowed to read / draft / execute.

---

## Catalog

| # | Playbook | WORKFLOW.md reference | Ships with PR |
|---|---|---|---|
| 1 | [Hours trust chain](./workflow-playbooks/hours-trust-chain.md) | Part 2.1 | PR-CHEF-1 |
| 2 | [Shift proposal → accept → confirm](./workflow-playbooks/shift-proposal-accept-confirm.md) | Part 1.6 | (currently live) |
| 3 | [Chef cancellation (severity tiers)](./workflow-playbooks/chef-cancellation.md) | Part 2.2 | PR-CHEF-5 |
| 4 | [Client hours signing](./workflow-playbooks/client-hours-signing.md) | Part 2.1 (sub-flow) | PR-CHEF-1 |
| 5 | [Admin bulk hours approval](./workflow-playbooks/admin-bulk-approval.md) | Part 2.1 (sub-flow) | PR-CHEF-3 |
| 6 | [Profile change request](./workflow-playbooks/profile-change-request.md) | Part 2.3 | PR-CHEF-4 |
| 7 | [Payroll export (CSV batch)](./workflow-playbooks/payroll-export.md) | Part 2.1 final stage | PR-CHEF-7 |
| 8 | [AVG consent gate](./workflow-playbooks/avg-consent.md) | Part 2.5 | PR-CHEF-10 |
| 9 | [Privacy request (inzage / correctie / verwijdering / export)](./workflow-playbooks/privacy-request.md) | Part 2.6 | PR-CHEF-10 |
| 10 | [Backup + restore drill](./workflow-playbooks/backup-restore.md) | Part 3.3 (workers) | PR-CHEF-13 |

---

## Cross-cutting concerns (covered in every playbook)

Each playbook addresses:

- **Atomic transitions** — every status change uses `UPDATE … WHERE id = ? AND status = '<expected>'` and rejects if 0 rows updated.
- **Outbox first** — external side effects go through `integration_outbox`, not direct API calls.
- **Idempotency** — every outbox event has a deterministic idempotency key on `(eventType, entityId, action)`.
- **Audit log** — every mutation writes to `audit_log` with a stable action key.
- **Notifications** — in-app + email, routed per `notification_routes` when applicable.
- **Human labels** — UI never shows raw enum; uses `humanStatus()` from `src/lib/hours-labels.ts`.
- **AI surface** — what the AI may read, draft, assist-execute, or never do.

---

## Workflows NOT in this catalog (intentionally)

Workflows that exist but don't yet have an AI surface (the AI doesn't act on them):

- Auth flows: signin, magic-link, password reset, 2FA enrollment + reset. The AI can REFER users to these flows but never executes them. See `tool-contracts/` — there's no `auth.*` write tool for AI.
- Internal staff invite. Same — refer-only.
- Public marketing pages (handled by CMS).
- Jotform webhook ingestion (system-side; AI reads triaged inbox, not raw webhook).

These remain documented in `WORKFLOW.md` Parts 1.1–1.5 but don't need their own AI playbook.

---

## How to add a new playbook

1. Copy the template from `README.md` (or any existing playbook).
2. Cite the matching section in `WORKFLOW.md`.
3. List the source tables touched.
4. Fill in the **allowed transitions** table.
5. Be explicit about **AI must never do** — when in doubt, list it.
6. Add to the table above.
7. Reflect any new audit keys in `ai-audit-and-logging.md`.
8. Add at least 2 golden tests to `ai-evaluation-set.md` exercising the new flow.

---

## Co-evolution rule

When a PR-CHEF-N ships its code, it ALSO ships the body of its playbook. The base playbook files in PR-AI-0 exist with the template + skeletal content; the feature PR fills in the operational detail (allowed transitions, real audit keys, real notification keys).

| PR | Adds / updates playbook |
|---|---|
| PR-CHEF-1 | `hours-trust-chain.md` · `client-hours-signing.md` |
| PR-CHEF-3 | `admin-bulk-approval.md` |
| PR-CHEF-4 | `profile-change-request.md` |
| PR-CHEF-5 | `chef-cancellation.md` |
| PR-CHEF-7 | `payroll-export.md` |
| PR-CHEF-10 | `avg-consent.md` · `privacy-request.md` |
| PR-CHEF-13 | `backup-restore.md` |
